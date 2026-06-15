import { supabase } from './supabase';
import { resolvePaymentPlanContact } from './resolvePaymentPlanContact';
import type { ProformaSendEmailInput } from './proformaSendEmail';
import type { ProformaSendLanguage } from './proformaSendLanguage';

export type PaymentPlanAutomationRow = {
  id: string | number;
  isLegacy?: boolean;
  client_id?: number | null;
  client?: string;
  dueDate?: string;
  paid?: boolean;
  proforma?: string | null;
};

export function paymentPlanSelectionKey(p: PaymentPlanAutomationRow): string {
  return `${p.isLegacy ? 'legacy' : 'new'}:${p.id}`;
}

export function parsePaymentPlanSelectionKey(key: string): { isLegacy: boolean; id: string } | null {
  const match = /^(legacy|new):(.+)$/.exec(key);
  if (!match) return null;
  return { isLegacy: match[1] === 'legacy', id: match[2] };
}

function paymentPlanTable(isLegacy: boolean): 'payment_plans' | 'finances_paymentplanrow' {
  return isLegacy ? 'finances_paymentplanrow' : 'payment_plans';
}

export function paymentPlanHasProforma(
  payment: PaymentPlanAutomationRow,
  legacyProformas: Array<{ ppr_id?: number | string | null }>,
): boolean {
  if (payment.paid) return false;
  if (payment.isLegacy) {
    return legacyProformas.some((row) => Number(row.ppr_id) === Number(payment.id));
  }
  return Boolean(payment.proforma && String(payment.proforma).trim() !== '');
}

export async function buildSendInvoiceInputForPaymentPlan(
  payment: PaymentPlanAutomationRow,
  params: {
    leadId: string | number;
    leadNumber: string;
    isLegacyLead: boolean;
    language: ProformaSendLanguage;
    legacyProformas: Array<{ id: string | number; ppr_id?: number | string | null }>;
  },
): Promise<ProformaSendEmailInput | null> {
  if (!paymentPlanHasProforma(payment, params.legacyProformas)) return null;

  const contact = await resolvePaymentPlanContact({
    leadId: params.isLegacyLead ? String(params.leadId).replace(/^legacy_/, '') : params.leadId,
    clientId: payment.client_id ?? null,
    clientNameFallback: payment.client,
  });

  if (!payment.isLegacy) {
    return {
      kind: 'new',
      recordId: payment.id,
      paymentPlanId: payment.id,
      contactId: contact.contactId,
      contactEmail: contact.email || null,
      contactPhone: contact.phone || null,
      clientName: contact.name || payment.client || 'Client',
      leadNumber: params.leadNumber,
      leadId: params.leadId,
      isLegacyLead: false,
      language: params.language,
    };
  }

  const proforma = params.legacyProformas.find((row) => Number(row.ppr_id) === Number(payment.id));
  if (!proforma) return null;

  const numericLeadId = Number(String(params.leadId).replace(/^legacy_/, ''));
  return {
    kind: 'legacy',
    recordId: proforma.id,
    paymentPlanId: Number(payment.id),
    contactId: contact.contactId,
    contactEmail: contact.email || null,
    contactPhone: contact.phone || null,
    clientName: contact.name || payment.client || 'Client',
    leadNumber: params.leadNumber,
    leadId: Number.isFinite(numericLeadId) ? numericLeadId : params.leadId,
    isLegacyLead: true,
    language: params.language,
  };
}

export async function enableInvoiceSendAutomation(
  payments: PaymentPlanAutomationRow[],
  language: ProformaSendLanguage,
  userId: string,
): Promise<number> {
  const now = new Date().toISOString();
  let updated = 0;

  for (const payment of payments) {
    const table = paymentPlanTable(Boolean(payment.isLegacy));
    const { error } = await supabase
      .from(table)
      .update({
        invoice_send_automation_active: true,
        invoice_send_automation_language: language,
        invoice_send_automation_at: now,
        invoice_send_automation_sent_at: null,
        invoice_send_automation_by: userId,
      })
      .eq('id', payment.id);

    if (!error) updated += 1;
    else console.error(`enableInvoiceSendAutomation ${table}#${payment.id}:`, error);
  }

  return updated;
}

export async function disableInvoiceSendAutomation(
  payments: PaymentPlanAutomationRow[],
): Promise<number> {
  let updated = 0;

  for (const payment of payments) {
    const table = paymentPlanTable(Boolean(payment.isLegacy));
    const { error } = await supabase
      .from(table)
      .update({
        invoice_send_automation_active: false,
        invoice_send_automation_language: null,
        invoice_send_automation_at: null,
        invoice_send_automation_sent_at: null,
        invoice_send_automation_by: null,
      })
      .eq('id', payment.id);

    if (!error) updated += 1;
    else console.error(`disableInvoiceSendAutomation ${table}#${payment.id}:`, error);
  }

  return updated;
}
