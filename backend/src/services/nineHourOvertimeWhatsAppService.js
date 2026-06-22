const supabase = require('../config/supabase');
const { invokeExpressHandler } = require('../lib/invokeExpressHandler');
const { sendMessage } = require('../controllers/whatsappController');
const { normalizePhoneForWhatsApp } = require('../lib/whatsappPhone');

const NINE_HOUR_WHATSAPP_TEMPLATE_ID = Number(
  process.env.NINE_HOUR_OVERTIME_WHATSAPP_TEMPLATE_ID || 46,
);

function sanitizeWhatsAppTemplateVariableText(text) {
  if (!text) return '';
  return String(text)
    .replace(/[\n\r\t]/g, ' ')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

async function hasNineHourWhatsAppBeenSent(employeeId, workDate) {
  const { data, error } = await supabase
    .from('employee_clock_in_nine_hour_whatsapp_sent')
    .select('employee_id')
    .eq('employee_id', employeeId)
    .eq('work_date', workDate)
    .maybeSingle();

  if (error) {
    console.error('[NineHourWhatsApp] dedupe lookup failed:', error.message);
    return false;
  }

  return data != null;
}

async function markNineHourWhatsAppSent(employeeId, workDate) {
  const { error } = await supabase.from('employee_clock_in_nine_hour_whatsapp_sent').upsert(
    { employee_id: employeeId, work_date: workDate, sent_at: new Date().toISOString() },
    { onConflict: 'employee_id,work_date' },
  );

  if (error) {
    console.error('[NineHourWhatsApp] failed to record send:', error.message);
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

async function sendNineHourOvertimeWhatsApp({ phoneNumber, displayName, template }) {
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
    sender_name: 'Nine-hour alert',
    isTemplate: true,
    templateId: Number(template.id),
    templateName: template.name,
    templateLanguage: template.language || 'en',
    message: filledContent || template.content || 'Nine-hour work limit reached',
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
 * Send template 46 once per employee per day when the nine-hour popup would appear.
 * @returns {{ sent: boolean, skipped?: string, error?: string }}
 */
async function sendNineHourOvertimeWhatsAppIfNeeded(employeeId, workDate) {
  if (!Number.isFinite(NINE_HOUR_WHATSAPP_TEMPLATE_ID) || NINE_HOUR_WHATSAPP_TEMPLATE_ID <= 0) {
    return { sent: false, skipped: 'invalid_template_id' };
  }

  if (await hasNineHourWhatsAppBeenSent(employeeId, workDate)) {
    return { sent: false, skipped: 'already_sent' };
  }

  const target = await fetchEmployeeWhatsAppTarget(employeeId);
  if (!target) {
    return { sent: false, skipped: 'no_employee_mobile' };
  }

  const template = await fetchWhatsAppTemplate(NINE_HOUR_WHATSAPP_TEMPLATE_ID);

  try {
    await sendNineHourOvertimeWhatsApp({
      phoneNumber: target.phoneNumber,
      displayName: target.displayName,
      template,
    });
    await markNineHourWhatsAppSent(employeeId, workDate);
    console.log(
      `[NineHourWhatsApp] employee=${employeeId} template=${NINE_HOUR_WHATSAPP_TEMPLATE_ID} sent to ${target.phoneNumber}`,
    );
    return { sent: true };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[NineHourWhatsApp] employee=${employeeId} send failed:`, message);
    return { sent: false, error: message };
  }
}

module.exports = {
  sendNineHourOvertimeWhatsAppIfNeeded,
  NINE_HOUR_WHATSAPP_TEMPLATE_ID,
  _internal: {
    buildTemplateParameters,
    fetchEmployeeWhatsAppTarget,
    normalizePhoneForWhatsApp,
  },
};
