import { supabase } from './supabase';
import type { ProformaSendEmailInput } from './proformaSendEmail';

export function resolveInvoiceSentAt(row: {
  invoice_sent_at?: string | null;
  invoice_send_automation_sent_at?: string | null;
}): string | null {
  const raw = row.invoice_sent_at || row.invoice_send_automation_sent_at || null;
  return raw ? String(raw) : null;
}

export function isPaymentPlanInvoiceSent(row: {
  invoice_sent?: boolean | null;
  invoice_sent_at?: string | null;
  invoice_send_automation_sent_at?: string | null;
}): boolean {
  return Boolean(row.invoice_sent) || Boolean(resolveInvoiceSentAt(row));
}

export function paymentPlanInvoiceSentState(row: {
  invoice_sent?: boolean | null;
  invoice_sent_at?: string | null;
  invoice_send_automation_sent_at?: string | null;
}): { invoice_sent: boolean; invoice_sent_at: string | null } {
  const invoice_sent_at = resolveInvoiceSentAt(row);
  return {
    invoice_sent: Boolean(row.invoice_sent) || Boolean(invoice_sent_at),
    invoice_sent_at,
  };
}

function resolveInvoiceSentTable(input: {
  isLegacyLead?: boolean;
  kind?: 'new' | 'legacy';
}): 'payment_plans' | 'finances_paymentplanrow' {
  if (input.isLegacyLead || input.kind === 'legacy') return 'finances_paymentplanrow';
  return 'payment_plans';
}

function resolveInvoiceSentPlanId(input: {
  paymentPlanId?: string | number | null;
  kind?: 'new' | 'legacy';
  recordId?: string | number | null;
}): string | number | null {
  if (input.paymentPlanId != null && String(input.paymentPlanId).trim() !== '') {
    return input.paymentPlanId;
  }
  if (input.kind === 'new' && input.recordId != null && String(input.recordId).trim() !== '') {
    return input.recordId;
  }
  return null;
}

/** Set invoice_sent + invoice_sent_at after a successful invoice send. */
export async function markPaymentPlanInvoiceSent(
  input: Pick<ProformaSendEmailInput, 'kind' | 'recordId' | 'paymentPlanId' | 'isLegacyLead'>,
): Promise<string> {
  const sentAt = new Date().toISOString();
  const planId = resolveInvoiceSentPlanId(input);
  if (planId == null) return sentAt;

  const table = resolveInvoiceSentTable(input);
  const { error } = await supabase
    .from(table)
    .update({ invoice_sent: true, invoice_sent_at: sentAt })
    .eq('id', planId);
  if (error) {
    console.warn(`markPaymentPlanInvoiceSent (${table}#${planId}):`, error.message);
  }
  return sentAt;
}
