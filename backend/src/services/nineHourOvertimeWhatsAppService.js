const supabase = require('../config/supabase');
const { invokeExpressHandler } = require('../lib/invokeExpressHandler');
const { sendMessage } = require('../controllers/whatsappController');
const { normalizePhoneForWhatsApp } = require('../lib/whatsappPhone');

/**
 * The two WhatsApp templates the clock-in policy sends, keyed by the stage that triggers them.
 *
 * - `reminder` goes out an hour before the employee's `min_hours`, warning them the day is nearly up.
 * - `clock_out` goes out when the auto clock-out has already fired at `min_hours`, which is why its
 *   wording is in the past tense and why it must never be sent while a session is still open.
 */
const CLOCK_IN_WHATSAPP_TEMPLATE_IDS = {
  reminder: Number(process.env.CLOCK_IN_MIN_HOURS_REMINDER_TEMPLATE_ID || 46),
  clock_out: Number(process.env.CLOCK_IN_MIN_HOURS_CLOCK_OUT_TEMPLATE_ID || 51),
};

/** The stages above, for callers that need to validate one before passing it in. */
const CLOCK_IN_WHATSAPP_STAGES = Object.keys(CLOCK_IN_WHATSAPP_TEMPLATE_IDS);

function sanitizeWhatsAppTemplateVariableText(text) {
  if (!text) return '';
  return String(text)
    .replace(/[\n\r\t]/g, ' ')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

/**
 * Whether this stage's message already went out today, or null when that cannot be determined.
 *
 * The null case matters: the scheduler runs every minute, so treating a failed lookup as "not sent
 * yet" would message the employee once a minute for the rest of their shift. The caller skips instead.
 */
async function hasClockInWhatsAppBeenSent(employeeId, workDate, stage) {
  const { data, error } = await supabase
    .from('employee_clock_in_nine_hour_whatsapp_sent')
    .select('employee_id')
    .eq('employee_id', employeeId)
    .eq('work_date', workDate)
    .eq('stage', stage)
    .maybeSingle();

  if (error) {
    console.error('[ClockInWhatsApp] dedupe lookup failed:', error.message);
    return null;
  }

  return data != null;
}

async function markClockInWhatsAppSent(employeeId, workDate, stage) {
  const { error } = await supabase.from('employee_clock_in_nine_hour_whatsapp_sent').upsert(
    { employee_id: employeeId, work_date: workDate, stage, sent_at: new Date().toISOString() },
    { onConflict: 'employee_id,work_date,stage' },
  );

  if (error) {
    console.error('[ClockInWhatsApp] failed to record send:', error.message);
  }
}

async function fetchEmployeeWhatsAppTarget(employeeId) {
  const { data, error } = await supabase
    .from('tenants_employee')
    .select('employee_mobile, display_name, official_name')
    .eq('id', employeeId)
    .maybeSingle();

  if (error) {
    throw new Error(`Employee lookup failed: ${error.message}`);
  }
  if (!data) {
    return null;
  }

  const phoneRaw = data.employee_mobile?.trim();
  const phoneNumber = phoneRaw ? normalizePhoneForWhatsApp(phoneRaw) : '';
  if (!phoneNumber) {
    return null;
  }

  const displayName =
    data.official_name?.trim()
    || data.display_name?.trim()
    || 'Employee';

  return { phoneNumber, displayName };
}

async function fetchWhatsAppTemplate(templateId) {
  const { data, error } = await supabase
    .from('whatsapp_templates_v2')
    .select('id, name, language, content, params, active')
    .eq('id', templateId)
    .maybeSingle();

  if (error) {
    throw new Error(`Failed to load WhatsApp template ${templateId}: ${error.message}`);
  }
  if (!data) {
    throw new Error(`WhatsApp template id ${templateId} was not found.`);
  }
  if (data.active === false) {
    throw new Error(`WhatsApp template id ${templateId} ("${data.name}") is not active.`);
  }

  return data;
}

function buildTemplateParameters(template, displayName) {
  const paramCount = Number(template.params) || 0;
  if (paramCount <= 0) return [];

  const name = sanitizeWhatsAppTemplateVariableText(displayName) || 'Employee';
  const parameters = [{ type: 'text', text: name }];

  while (parameters.length < paramCount) {
    parameters.push({ type: 'text', text: 'N/A' });
  }

  return parameters.slice(0, paramCount);
}

async function sendClockInWhatsApp({ phoneNumber, displayName, template }) {
  const paramCount = Number(template.params) || 0;
  const templateParameters = buildTemplateParameters(template, displayName);

  let filledContent = template.content || '';
  if (templateParameters.length > 0) {
    templateParameters.forEach((param, index) => {
      if (param?.text) {
        filledContent = filledContent.replace(
          new RegExp(`\\{\\{${index + 1}\\}\\}`, 'g'),
          param.text,
        );
      }
    });
  }

  const messagePayload = {
    leadId: null,
    phoneNumber,
    sender_name: 'Clock-in alert',
    isTemplate: true,
    templateId: Number(template.id),
    templateName: template.name,
    templateLanguage: template.language || 'en',
    message: filledContent || template.content || 'Working hours limit reached',
  };

  if (paramCount > 0) {
    messagePayload.templateParameters = templateParameters;
  }

  const { status, data } = await invokeExpressHandler(sendMessage, { body: messagePayload });

  const isDbSaveError =
    status >= 400
    && data?.error
    && (String(data.error).includes('save') || String(data.error).includes('Failed to save message'));

  if (isDbSaveError) {
    return { ok: true, warning: 'WhatsApp sent but message log save failed' };
  }

  if (status >= 400) {
    throw new Error(data?.error || `WhatsApp send failed (HTTP ${status})`);
  }

  return { ok: true };
}

/**
 * Send one stage's template, at most once per employee per day.
 *
 * @param {number} employeeId
 * @param {string} workDate Jerusalem date key, which is what the dedupe table is keyed on.
 * @param {'reminder'|'clock_out'} stage
 * @returns {{ sent: boolean, skipped?: string, error?: string }}
 */
async function sendClockInWhatsAppIfNeeded(employeeId, workDate, stage) {
  const templateId = CLOCK_IN_WHATSAPP_TEMPLATE_IDS[stage];
  if (templateId === undefined) {
    return { sent: false, skipped: 'unknown_stage' };
  }
  if (!Number.isFinite(templateId) || templateId <= 0) {
    return { sent: false, skipped: 'invalid_template_id' };
  }

  const alreadySent = await hasClockInWhatsAppBeenSent(employeeId, workDate, stage);
  // Staying quiet beats messaging every minute: without a working dedupe there is nothing to stop it.
  if (alreadySent === null) {
    return { sent: false, skipped: 'dedupe_unavailable' };
  }
  if (alreadySent) {
    return { sent: false, skipped: 'already_sent' };
  }

  const target = await fetchEmployeeWhatsAppTarget(employeeId);
  if (!target) {
    return { sent: false, skipped: 'no_employee_mobile' };
  }

  const template = await fetchWhatsAppTemplate(templateId);

  try {
    await sendClockInWhatsApp({
      phoneNumber: target.phoneNumber,
      displayName: target.displayName,
      template,
    });
    await markClockInWhatsAppSent(employeeId, workDate, stage);
    console.log(
      `[ClockInWhatsApp] employee=${employeeId} stage=${stage} template=${templateId} sent to ${target.phoneNumber}`,
    );
    return { sent: true };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[ClockInWhatsApp] employee=${employeeId} stage=${stage} send failed:`, message);
    return { sent: false, error: message };
  }
}

module.exports = {
  sendClockInWhatsAppIfNeeded,
  CLOCK_IN_WHATSAPP_TEMPLATE_IDS,
  CLOCK_IN_WHATSAPP_STAGES,
  _internal: {
    buildTemplateParameters,
    fetchEmployeeWhatsAppTarget,
    normalizePhoneForWhatsApp,
  },
};
