const supabase = require('../config/supabase');
const { resolvePaymentPlanContact } = require('../lib/resolvePaymentPlanContact');
const { sendProformaInvoiceBundleBackend } = require('./proformaInvoiceSendService');

function getJerusalemDateKey(date = new Date()) {
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Jerusalem',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  const parts = Object.fromEntries(
    fmt.formatToParts(date).filter((p) => p.type !== 'literal').map((p) => [p.type, p.value]),
  );
  return `${parts.year}-${parts.month}-${parts.day}`;
}

function normalizeLanguage(raw) {
  const lang = String(raw || 'en').trim().toLowerCase();
  return lang === 'he' ? 'he' : 'en';
}

function hasProformaText(proforma) {
  return Boolean(proforma && String(proforma).trim() !== '');
}

async function resolveLeadNumber(leadId, isLegacy) {
  if (isLegacy) {
    const numericId = parseInt(String(leadId).replace(/^legacy_/, ''), 10);
    if (!Number.isFinite(numericId)) return String(leadId);
    const { data } = await supabase
      .from('leads_lead')
      .select('id')
      .eq('id', numericId)
      .maybeSingle();
    return data?.id != null ? String(data.id) : String(numericId);
  }

  const { data } = await supabase
    .from('leads')
    .select('lead_number')
    .eq('id', leadId)
    .maybeSingle();

  return data?.lead_number?.trim() || String(leadId);
}

async function fetchDueModernRows(dueDate) {
  const { data, error } = await supabase
    .from('payment_plans')
    .select(
      'id, lead_id, client_id, client_name, proforma, due_date, invoice_send_automation_language, invoice_send_automation_by',
    )
    .eq('invoice_send_automation_active', true)
    .is('invoice_send_automation_sent_at', null)
    .is('cancel_date', null)
    .eq('paid', false)
    .eq('due_date', dueDate);

  if (error) throw new Error(error.message || 'Failed to load modern payment plans');
  return (data || []).filter((row) => hasProformaText(row.proforma));
}

async function fetchDueLegacyRows(dueDate) {
  const { data, error } = await supabase
    .from('finances_paymentplanrow')
    .select(
      'id, lead_id, client_id, date, due_date, invoice_send_automation_language, invoice_send_automation_by',
    )
    .eq('invoice_send_automation_active', true)
    .is('invoice_send_automation_sent_at', null)
    .is('cancel_date', null)
    .is('actual_date', null)
    .or(`date.eq.${dueDate},due_date.eq.${dueDate}`);

  if (error) throw new Error(error.message || 'Failed to load legacy payment plans');

  const rows = data || [];
  if (!rows.length) return [];

  const ids = rows.map((r) => r.id);
  const { data: proformas, error: proformaError } = await supabase
    .from('proformainvoice')
    .select('id, ppr_id')
    .in('ppr_id', ids);

  if (proformaError) {
    throw new Error(proformaError.message || 'Failed to load legacy proformas');
  }

  const proformaByPpr = new Map((proformas || []).map((p) => [Number(p.ppr_id), p]));
  return rows
    .filter((row) => proformaByPpr.has(Number(row.id)))
    .map((row) => ({
      ...row,
      proformaRecord: proformaByPpr.get(Number(row.id)),
    }));
}

async function buildSendInputFromModernRow(row) {
  const leadId = row.lead_id;
  const leadNumber = await resolveLeadNumber(leadId, false);
  const contact = await resolvePaymentPlanContact({
    leadId,
    clientId: row.client_id ?? null,
    clientNameFallback: row.client_name,
  });

  return {
    kind: 'new',
    recordId: row.id,
    paymentPlanId: row.id,
    contactId: contact.contactId,
    contactEmail: contact.email || null,
    contactPhone: contact.phone || null,
    clientName: contact.name || row.client_name || 'Client',
    leadNumber,
    leadId,
    isLegacyLead: false,
    language: normalizeLanguage(row.invoice_send_automation_language),
    mailboxUserId: row.invoice_send_automation_by,
    table: 'payment_plans',
    rowId: row.id,
  };
}

async function buildSendInputFromLegacyRow(row) {
  const leadId = row.lead_id;
  const leadNumber = await resolveLeadNumber(leadId, true);
  const contact = await resolvePaymentPlanContact({
    leadId,
    clientId: row.client_id ?? null,
    clientNameFallback: 'Client',
  });

  return {
    kind: 'legacy',
    recordId: row.proformaRecord.id,
    paymentPlanId: Number(row.id),
    contactId: contact.contactId,
    contactEmail: contact.email || null,
    contactPhone: contact.phone || null,
    clientName: contact.name || 'Client',
    leadNumber,
    leadId,
    isLegacyLead: true,
    language: normalizeLanguage(row.invoice_send_automation_language),
    mailboxUserId: row.invoice_send_automation_by,
    table: 'finances_paymentplanrow',
    rowId: row.id,
  };
}

async function resolveEmployeeIdFromAuthUserId(authUserId) {
  if (!authUserId) return null;

  const { data: userData } = await supabase
    .from('users')
    .select('employee_id, email, full_name')
    .eq('auth_id', authUserId)
    .maybeSingle();

  if (userData?.employee_id && typeof userData.employee_id === 'number') {
    return userData.employee_id;
  }

  if (userData?.email) {
    const { data: byEmail } = await supabase
      .from('users')
      .select('employee_id')
      .eq('email', userData.email)
      .maybeSingle();
    if (byEmail?.employee_id && typeof byEmail.employee_id === 'number') {
      return byEmail.employee_id;
    }
  }

  return null;
}

async function resolveUserNameFromAuthUserId(authUserId) {
  if (!authUserId) return 'Automation';

  const { data: userData } = await supabase
    .from('users')
    .select('full_name, email')
    .eq('auth_id', authUserId)
    .maybeSingle();

  return userData?.full_name?.trim() || userData?.email?.trim() || 'Automation';
}

async function logReadyToPayHistory({ leadId, rowId, employeeId, changedBy }) {
  if (!leadId) return;

  const { error } = await supabase.from('finance_changes_history').insert({
    lead_id: leadId,
    change_type: 'payment_marked_ready_to_pay',
    table_name: 'payment_plans',
    record_id: rowId,
    old_values: { ready_to_pay: false },
    new_values: { ready_to_pay: true, ready_to_pay_by: employeeId },
    changed_by: changedBy,
    notes: `Payment marked as ready to pay by invoice automation (${changedBy})`,
  });

  if (error) {
    console.warn(`[InvoiceAutomation] finance_changes_history insert failed for payment_plans#${rowId}:`, error.message);
  }
}

async function markAutomationComplete({ table, rowId, isLegacy, leadId, authUserId, dueDate }) {
  const employeeId = await resolveEmployeeIdFromAuthUserId(authUserId);
  const changedBy = await resolveUserNameFromAuthUserId(authUserId);
  const today = dueDate || getJerusalemDateKey();
  const sentAt = new Date().toISOString();

  const update = {
    invoice_send_automation_sent_at: sentAt,
    ready_to_pay: true,
    due_date: today,
  };

  if (isLegacy) {
    update.date = today;
    if (employeeId != null) {
      update.ready_to_pay_by = employeeId;
      update.due_by_id = employeeId;
    }
  } else if (employeeId != null) {
    update.ready_to_pay_by = employeeId;
  }

  const { error } = await supabase
    .from(table)
    .update(update)
    .eq('id', rowId)
    .is('invoice_send_automation_sent_at', null);

  if (error) {
    throw new Error(error.message || `Failed to complete automation on ${table}#${rowId}`);
  }

  if (!isLegacy) {
    await logReadyToPayHistory({ leadId, rowId, employeeId, changedBy });
  }

  return { readyToPay: true, employeeId, changedBy, sentAt };
}

async function processDueRow(sendInput, { dryRun = false } = {}) {
  const { table, rowId, mailboxUserId, ...bundleInput } = sendInput;

  if (!mailboxUserId) {
    return {
      rowId,
      table,
      skipped: true,
      reason: 'no_mailbox_user',
    };
  }

  if (dryRun) {
    return {
      rowId,
      table,
      dryRun: true,
      wouldSend: true,
      wouldMarkReadyToPay: true,
      language: bundleInput.language,
      kind: bundleInput.kind,
    };
  }

  const result = await sendProformaInvoiceBundleBackend(bundleInput, mailboxUserId);
  const completion = await markAutomationComplete({
    table,
    rowId,
    isLegacy: Boolean(bundleInput.isLegacyLead),
    leadId: bundleInput.leadId,
    authUserId: mailboxUserId,
    dueDate: getJerusalemDateKey(),
  });

  return {
    rowId,
    table,
    sent: true,
    emailSent: result.emailSent,
    whatsAppSent: result.whatsAppSent,
    whatsAppPhone: result.whatsAppPhone,
    readyToPay: completion.readyToPay,
  };
}

/**
 * Process all payment plan rows due for automated invoice send.
 * @param {{ dueDate?: string, dryRun?: boolean }} options
 */
async function processDueInvoiceAutomations(options = {}) {
  const dueDate = options.dueDate || getJerusalemDateKey();
  const dryRun = Boolean(options.dryRun);

  const [modernRows, legacyRows] = await Promise.all([
    fetchDueModernRows(dueDate),
    fetchDueLegacyRows(dueDate),
  ]);

  const results = [];
  const errors = [];

  for (const row of modernRows) {
    try {
      const input = await buildSendInputFromModernRow(row);
      const outcome = await processDueRow(input, { dryRun });
      results.push(outcome);
    } catch (err) {
      const message = err?.message || String(err);
      errors.push({ table: 'payment_plans', rowId: row.id, error: message });
      console.error(`[InvoiceAutomation] modern#${row.id}:`, message);
    }
  }

  for (const row of legacyRows) {
    try {
      const input = await buildSendInputFromLegacyRow(row);
      const outcome = await processDueRow(input, { dryRun });
      results.push(outcome);
    } catch (err) {
      const message = err?.message || String(err);
      errors.push({ table: 'finances_paymentplanrow', rowId: row.id, error: message });
      console.error(`[InvoiceAutomation] legacy#${row.id}:`, message);
    }
  }

  const sent = results.filter((r) => r.sent).length;
  const skipped = results.filter((r) => r.skipped).length;
  const dryRunCount = results.filter((r) => r.dryRun).length;

  return {
    dueDate,
    dryRun,
    pendingModern: modernRows.length,
    pendingLegacy: legacyRows.length,
    processed: results.length,
    sent,
    skipped,
    dryRunCount,
    results,
    errors,
  };
}

module.exports = {
  getJerusalemDateKey,
  processDueInvoiceAutomations,
};
