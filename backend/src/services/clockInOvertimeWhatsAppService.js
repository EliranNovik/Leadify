const supabase = require('../config/supabase');
const { invokeExpressHandler } = require('../lib/invokeExpressHandler');
const { sendMessage } = require('../controllers/whatsappController');
const { normalizePhoneForWhatsApp } = require('../lib/whatsappPhone');

/**
 * Michael Decker, stored as country code + number with no plus (972547652074).
 * HR_NUMBER in the backend overrides this. An empty or unusable value falls back here.
 */
const DEFAULT_HR_PHONE = '972547652074';

function resolveHrPhone() {
  try {
    const configured = String(process.env.HR_NUMBER || '').trim();
    const normalized = normalizePhoneForWhatsApp(configured);
    if (normalized && normalized.startsWith('972') && normalized.length >= 11) return normalized;
  } catch (err) {
    console.warn('[ClockInOvertimeWhatsApp] HR_NUMBER could not be read:', err?.message || err);
  }
  return normalizePhoneForWhatsApp(DEFAULT_HR_PHONE);
}

const DECLINE_NOTE = 'Declined by Michael Decker on WhatsApp';

function templateId() {
  const id = Number(String(process.env.CLOCK_IN_OVERTIME_APPROVAL_TEMPLATE_ID || '').trim());
  return Number.isFinite(id) && id > 0 ? id : 0;
}

function fail(statusCode, message) {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
}

function sanitizeWhatsAppTemplateVariableText(text) {
  return String(text || '')
    .replace(/[\n\r\t]/g, ' ')
    .replace(/\s{4,}/g, ' ')
    .replace(/\s{2,}/g, ' ')
    .trim()
    .slice(0, 900);
}

function decisionFromReply(text) {
  const value = String(text || '')
    .trim()
    .toLowerCase()
    .replace(/^button clicked:\s*/, '')
    .trim();
  if (!value) return null;
  if (['yes', 'y', 'approve', 'approved', 'confirm', 'confirmed', 'כן', 'אישור', 'overtime_yes'].includes(value)) {
    return 'approved';
  }
  if (['no', 'n', 'decline', 'declined', 'reject', 'rejected', 'לא', 'דחייה', 'overtime_no'].includes(value)) {
    return 'declined';
  }
  return null;
}

async function fetchWhatsAppTemplate(id) {
  const { data, error } = await supabase
    .from('whatsapp_templates_v2')
    .select('id, name, language, content, params, active, param_mapping')
    .eq('id', id)
    .maybeSingle();

  if (error) throw fail(500, `Failed to load WhatsApp template ${id}: ${error.message}`);
  if (!data) throw fail(500, `WhatsApp template id ${id} was not found.`);
  if (data.active === false) {
    throw fail(500, `WhatsApp template id ${id} ("${data.name}") is not active.`);
  }
  const paramCount = Number(data.params) || 0;
  if (paramCount < 5) {
    throw fail(
      500,
      `WhatsApp template ${id} needs 5 body placeholders (employee, description, hours, workplace, date). It has ${paramCount}.`,
    );
  }
  return data;
}

async function fetchEmployeeName(employeeId) {
  const { data, error } = await supabase
    .from('tenants_employee')
    .select('display_name, official_name')
    .eq('id', employeeId)
    .maybeSingle();

  if (error) throw fail(500, `Employee lookup failed: ${error.message}`);
  if (!data) throw fail(404, 'Employee was not found');

  return sanitizeWhatsAppTemplateVariableText(data.official_name || data.display_name) || 'Employee';
}

async function assertClockInsBelongToEmployee(employeeId, clockInIds) {
  const { data, error } = await supabase
    .from('employee_clock_in')
    .select('id, employee_id')
    .in('id', clockInIds);

  if (error) throw fail(500, `Clock-in lookup failed: ${error.message}`);

  const rows = data || [];
  if (rows.length !== clockInIds.length) {
    throw fail(400, 'One or more clock-in entries could not be found');
  }
  if (rows.some((row) => Number(row.employee_id) !== employeeId)) {
    throw fail(403, 'Those clock-in entries belong to another employee');
  }
}

/**
 * Send the overtime template to Michael and store the outbound message id against the clock-ins.
 *
 * Placeholders: {{1}} employee, {{2}} the reason the employee typed, {{3}} the extra hours, {{4}} workplace, {{5}} date.
 * Custom Text in the template manager is not used here. That value is a fixed string.
 *
 * @param {{ employeeId: number, reason: string, hours: string, workplace: string, date: string, clockInIds: number[] }} input
 */
async function sendOvertimeApprovalRequest(input) {
  const employeeId = Number(input.employeeId);
  const clockInIds = [...new Set((input.clockInIds || []).map((id) => Number(id)).filter((id) => Number.isFinite(id) && id > 0))];
  const reason = sanitizeWhatsAppTemplateVariableText(input.reason);
  const hours = sanitizeWhatsAppTemplateVariableText(input.hours);
  const workplace = sanitizeWhatsAppTemplateVariableText(input.workplace) || 'Not set';
  const workDate = sanitizeWhatsAppTemplateVariableText(input.date);

  if (!Number.isFinite(employeeId) || employeeId <= 0) throw fail(400, 'Missing employee');
  if (clockInIds.length === 0) throw fail(400, 'No clock-in entries to approve');
  if (clockInIds.length > 40) throw fail(400, 'Too many clock-in entries in one request');
  if (!reason) throw fail(400, 'Write the reason for the extra hours');
  if (!hours) throw fail(400, 'Missing overtime hours');
  if (!workDate) throw fail(400, 'Missing overtime date');

  const id = templateId();
  if (!id) {
    throw fail(
      503,
      'Overtime WhatsApp template is not configured yet. Set CLOCK_IN_OVERTIME_APPROVAL_TEMPLATE_ID.',
    );
  }

  await assertClockInsBelongToEmployee(employeeId, clockInIds);

  const employeeName = await fetchEmployeeName(employeeId);
  const description = reason;
  const template = await fetchWhatsAppTemplate(id);
  const paramCount = Number(template.params) || 0;
  const valuesByType = {
    employee: employeeName,
    description,
    hours,
    workplace,
    date: workDate,
  };
  const mapping = Array.isArray(template.param_mapping) ? template.param_mapping : [];
  const mappingReady = mapping.length >= paramCount && paramCount > 0;
  const templateParameters = [];

  if (mappingReady) {
    for (let index = 0; index < paramCount; index += 1) {
      const slot = mapping[index] || {};
      const mapped = slot.type === 'custom'
        ? sanitizeWhatsAppTemplateVariableText(slot.value)
        : valuesByType[slot.type];
      templateParameters.push({ type: 'text', text: mapped || 'N/A' });
    }
  } else {
    templateParameters.push(
      { type: 'text', text: employeeName },
      { type: 'text', text: description },
      { type: 'text', text: hours },
      { type: 'text', text: workplace },
      { type: 'text', text: workDate },
    );
    while (templateParameters.length < paramCount) {
      templateParameters.push({ type: 'text', text: 'N/A' });
    }
  }

  let filledContent = template.content || '';
  templateParameters.forEach((param, index) => {
    filledContent = filledContent.replace(
      new RegExp(`\\{\\{${index + 1}\\}\\}`, 'g'),
      param.text,
    );
  });

  const { data: requestRow, error: insertError } = await supabase
    .from('employee_clock_in_overtime_requests')
    .insert({
      employee_id: employeeId,
      clock_in_ids: clockInIds,
      employee_name: employeeName,
      reason,
      description,
      status: 'pending',
    })
    .select('id')
    .single();

  if (insertError) {
    throw fail(
      500,
      `The approval request could not be saved (${insertError.message}). Run sql/2026-11-16_employee_clock_in_overtime_whatsapp.sql.`,
    );
  }

  const phoneNumber = resolveHrPhone();
  let status = 500;
  let data = null;
  try {
    const sent = await invokeExpressHandler(sendMessage, {
      body: {
        leadId: null,
        phoneNumber,
        sender_name: 'Overtime approval',
        isTemplate: true,
        templateId: Number(template.id),
        templateName: template.name,
        templateLanguage: template.language || 'en',
        templateParameters: templateParameters.slice(0, paramCount),
        message: filledContent || description,
      },
    });
    status = sent.status;
    data = sent.data;
  } catch (sendError) {
    await supabase.from('employee_clock_in_overtime_requests').delete().eq('id', requestRow.id);
    throw fail(502, sendError?.message || 'WhatsApp send failed');
  }

  const whatsappMessageId = data?.messageId ? String(data.messageId) : '';
  if (status >= 400 || !whatsappMessageId) {
    await supabase.from('employee_clock_in_overtime_requests').delete().eq('id', requestRow.id);
    throw fail(502, data?.error || `WhatsApp send failed (HTTP ${status})`);
  }

  const { error: linkError } = await supabase
    .from('employee_clock_in_overtime_requests')
    .update({ whatsapp_message_id: whatsappMessageId })
    .eq('id', requestRow.id);

  if (linkError) {
    console.error(
      '[ClockInOvertimeWhatsApp] sent but the reply id was not stored:',
      linkError.message,
      whatsappMessageId,
    );
  }

  return {
    requestId: requestRow.id,
    messageId: whatsappMessageId,
  };
}

async function restoreSessionBeforeOvertime(id) {
  const { data: revisions, error } = await supabase
    .from('employee_clock_in_revisions')
    .select('clock_in_time, clock_out_time, notes, approved, declined, manually, approved_at')
    .eq('clock_in_id', id)
    .order('created_at', { ascending: false })
    .limit(1);

  if (error || !revisions?.length || !revisions[0].clock_out_time) return false;
  const previous = revisions[0];
  const { error: restoreError } = await supabase
    .from('employee_clock_in')
    .update({
      clock_in_time: previous.clock_in_time,
      clock_out_time: previous.clock_out_time,
      notes: previous.notes,
      approved: previous.approved === true,
      declined: previous.declined === true,
      manually: previous.manually === true,
      approved_at: previous.approved === true ? previous.approved_at : null,
      approved_by: null,
      decline_note: null,
    })
    .eq('id', id);

  return !restoreError;
}

async function applyDecision(request, decision) {
  const ids = (request.clock_in_ids || []).map((id) => Number(id)).filter((id) => Number.isFinite(id) && id > 0);
  if (ids.length === 0) return false;

  const now = new Date().toISOString();
  if (decision === 'declined') {
    const unrestored = [];
    for (const id of ids) {
      const restored = await restoreSessionBeforeOvertime(id);
      if (!restored) unrestored.push(id);
    }
    if (unrestored.length === 0) {
      const { data: updated, error } = await supabase
        .from('employee_clock_in_overtime_requests')
        .update({ status: decision, resolved_at: now })
        .eq('id', request.id)
        .eq('status', 'pending')
        .select('id');
      if (error) throw new Error(`Could not update the overtime request: ${error.message}`);
      return (updated || []).length > 0;
    }
    ids.splice(0, ids.length, ...unrestored);
  }

  const clockInPatch = decision === 'approved'
    ? {
      approved: true,
      declined: false,
      approved_at: now,
      approved_by: null,
      decline_note: null,
    }
    : {
      approved: false,
      declined: true,
      approved_at: null,
      approved_by: null,
      decline_note: DECLINE_NOTE,
    };

  let clockInResult = await supabase
    .from('employee_clock_in')
    .update(clockInPatch)
    .in('id', ids);

  if (clockInResult.error && /decline_note/i.test(clockInResult.error.message || '')) {
    const withoutNote = { ...clockInPatch };
    delete withoutNote.decline_note;
    clockInResult = await supabase.from('employee_clock_in').update(withoutNote).in('id', ids);
  }

  if (clockInResult.error) {
    throw new Error(`Could not update clock-in rows: ${clockInResult.error.message}`);
  }

  const { data: updated, error } = await supabase
    .from('employee_clock_in_overtime_requests')
    .update({ status: decision, resolved_at: now })
    .eq('id', request.id)
    .eq('status', 'pending')
    .select('id');

  if (error) throw new Error(`Could not update the overtime request: ${error.message}`);
  return (updated || []).length > 0;
}

/**
 * Michael tapped Yes or No on the overtime template. Other button replies are ignored.
 *
 * @param {{ phoneNumber?: string, contextId?: string, text?: string }} reply
 */
async function handleButtonReply(reply) {
  const decision = decisionFromReply(reply?.text);
  const contextId = reply?.contextId ? String(reply.contextId).trim() : '';
  if (!decision || !contextId) return { matched: false };

  const from = normalizePhoneForWhatsApp(reply?.phoneNumber || '');
  const michael = resolveHrPhone();
  if (!from || from !== michael) return { matched: false };

  const { data: request, error } = await supabase
    .from('employee_clock_in_overtime_requests')
    .select('id, status, clock_in_ids, whatsapp_message_id')
    .eq('whatsapp_message_id', contextId)
    .maybeSingle();

  if (error) {
    if (/employee_clock_in_overtime_requests/i.test(error.message || '')) return { matched: false };
    throw new Error(error.message);
  }
  if (!request || request.status !== 'pending') return { matched: Boolean(request) };

  const changed = await applyDecision(request, decision);
  console.log('[ClockInOvertimeWhatsApp] Michael replied', {
    requestId: request.id,
    decision,
    changed,
  });
  return { matched: true, decision, changed };
}

function phonesMatch(left, right) {
  const a = normalizePhoneForWhatsApp(left);
  const b = normalizePhoneForWhatsApp(right);
  return Boolean(a && b && a === b);
}

/**
 * The public WhatsApp webhook stores Michael's Yes/No before this approval code runs.
 * Match those saved button replies to a pending request and apply them.
 */
async function reconcileHrButtonReplies() {
  const michael = resolveHrPhone();
  const { data: pending, error } = await supabase
    .from('employee_clock_in_overtime_requests')
    .select('id, status, clock_in_ids, whatsapp_message_id, created_at')
    .eq('status', 'pending')
    .not('whatsapp_message_id', 'is', null)
    .order('created_at', { ascending: true })
    .limit(20);

  if (error) {
    if (/employee_clock_in_overtime_requests/i.test(error.message || '')) return { applied: 0 };
    throw new Error(error.message);
  }
  if (!pending?.length) return { applied: 0 };

  const { data: replies, error: replyError } = await supabase
    .from('whatsapp_messages')
    .select('id, message, message_type, phone_number, sent_at, whatsapp_message_id, direction')
    .eq('direction', 'in')
    .eq('message_type', 'button_response')
    .gte('sent_at', pending[0].created_at)
    .order('sent_at', { ascending: true })
    .limit(80);

  if (replyError) throw new Error(replyError.message);

  const seenReplyIds = new Set();
  const open = pending.slice();
  let applied = 0;

  for (const reply of replies || []) {
    const replyKey = reply.whatsapp_message_id || `row:${reply.id}`;
    if (seenReplyIds.has(replyKey)) continue;
    seenReplyIds.add(replyKey);
    if (!phonesMatch(reply.phone_number, michael)) continue;
    const decision = decisionFromReply(reply.message);
    if (!decision) continue;

    const sentAt = new Date(reply.sent_at).getTime();
    let matchIndex = -1;
    for (let i = open.length - 1; i >= 0; i -= 1) {
      const createdAt = new Date(open[i].created_at).getTime();
      if (Number.isFinite(createdAt) && createdAt <= sentAt) {
        matchIndex = i;
        break;
      }
    }
    if (matchIndex < 0) continue;

    const request = open[matchIndex];
    const changed = await applyDecision(request, decision);
    open.splice(matchIndex, 1);
    if (changed) {
      applied += 1;
      console.log('[ClockInOvertimeWhatsApp] Applied stored button reply', {
        requestId: request.id,
        decision,
        replyId: reply.whatsapp_message_id,
      });
    }
  }

  return { applied };
}

module.exports = {
  DEFAULT_HR_PHONE,
  resolveHrPhone,
  sendOvertimeApprovalRequest,
  handleButtonReply,
  reconcileHrButtonReplies,
};
