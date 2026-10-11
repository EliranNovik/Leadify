import { supabase } from './supabase';

/**
 * The manual "tax invoice sent" record on a payment plan row.
 *
 * Separate from `invoice_sent`, which is the proforma / payment-request invoice. A tax invoice is
 * normally issued automatically by Payper when a payment link is paid; these columns exist for the
 * invoices sent outside that flow, which otherwise leave no trace in the CRM at all.
 */
export type PaymentPlanTaxInvoiceRow = {
  tax_invoice_sent?: boolean | null;
  tax_invoice_sent_at?: string | null;
  tax_invoice_sent_by?: number | string | null;
};

export type PaymentPlanTaxInvoiceState = {
  sent: boolean;
  sentAt: string | null;
  sentByEmployeeId: number | null;
};

export function paymentPlanTaxInvoiceState(
  row: PaymentPlanTaxInvoiceRow | null | undefined,
): PaymentPlanTaxInvoiceState {
  const sentAt = row?.tax_invoice_sent_at ? String(row.tax_invoice_sent_at) : null;
  const rawBy = row?.tax_invoice_sent_by;
  const parsedBy = rawBy == null || rawBy === '' ? NaN : Number(rawBy);
  return {
    // The date alone counts as sent: a row stamped by an older write that never set the flag should
    // still read as sent rather than silently showing as unsent.
    sent: Boolean(row?.tax_invoice_sent) || Boolean(sentAt),
    sentAt,
    sentByEmployeeId: Number.isFinite(parsedBy) ? parsedBy : null,
  };
}

/**
 * The three columns in the shape a UI payment row carries them, for spreading onto a mapped row.
 * Keeping the database names means a row can be handed straight back to `paymentPlanTaxInvoiceState`.
 */
export function paymentPlanTaxInvoiceFields(row: PaymentPlanTaxInvoiceRow | null | undefined): {
  tax_invoice_sent: boolean;
  tax_invoice_sent_at: string | null;
  tax_invoice_sent_by: number | null;
} {
  const state = paymentPlanTaxInvoiceState(row);
  return {
    tax_invoice_sent: state.sent,
    tax_invoice_sent_at: state.sentAt,
    tax_invoice_sent_by: state.sentByEmployeeId,
  };
}

export type TaxInvoiceTarget = {
  /** Which payment table the row lives in. */
  isLegacyLead?: boolean;
  kind?: 'new' | 'legacy';
  paymentPlanId?: string | number | null;
  recordId?: string | number | null;
};

function resolveTable(target: TaxInvoiceTarget): 'payment_plans' | 'finances_paymentplanrow' {
  if (target.isLegacyLead || target.kind === 'legacy') return 'finances_paymentplanrow';
  return 'payment_plans';
}

function resolvePlanId(target: TaxInvoiceTarget): string | number | null {
  if (target.paymentPlanId != null && String(target.paymentPlanId).trim() !== '') {
    return target.paymentPlanId;
  }
  if (target.recordId != null && String(target.recordId).trim() !== '') {
    return target.recordId;
  }
  return null;
}

/**
 * The signed-in user's employee id, for stamping who marked the invoice.
 *
 * Forgiving by design: a missing employee id must not stop the mark from being recorded, so every
 * failure path yields null rather than throwing.
 */
async function resolveActorEmployeeId(): Promise<number | null> {
  try {
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user?.id) return null;

    let { data: row } = await supabase
      .from('users')
      .select('employee_id')
      .eq('auth_id', user.id)
      .maybeSingle();
    if ((row?.employee_id == null || row.employee_id === '') && user.email) {
      const { data: byEmail } = await supabase
        .from('users')
        .select('employee_id')
        .eq('email', user.email)
        .maybeSingle();
      if (byEmail) row = byEmail;
    }

    const raw = row?.employee_id;
    const parsed = raw == null || raw === '' ? NaN : Number(raw);
    return Number.isFinite(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

/**
 * The instant to store for a date the user picked.
 *
 * Noon rather than midnight: a date-only choice stored as midnight UTC reads as the previous day
 * anywhere west of Greenwich, and as midnight local it lands on the day boundary where a timezone
 * shift of a couple of hours changes the date. Midday is the furthest point from both edges.
 */
export function taxInvoiceSentAtFromDateKey(dateKey: string): string {
  return new Date(`${dateKey}T12:00:00`).toISOString();
}

/** Today in Jerusalem as `YYYY-MM-DD`, for pre-filling the date picker. */
export function taxInvoiceTodayDateKey(date = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Jerusalem',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date);
}

/** The `YYYY-MM-DD` a stored timestamp falls on in Jerusalem, for re-opening the picker on it. */
export function taxInvoiceDateKeyFromSentAt(sentAt: string | null): string {
  if (!sentAt) return taxInvoiceTodayDateKey();
  const parsed = new Date(sentAt);
  return Number.isNaN(parsed.getTime()) ? taxInvoiceTodayDateKey() : taxInvoiceTodayDateKey(parsed);
}

export type MarkTaxInvoiceSentResult = PaymentPlanTaxInvoiceState & {
  ok: boolean;
  /** Why the write failed, for showing the user rather than only logging it. */
  error?: string;
};

/**
 * Record that the tax invoice for a payment row was sent on `sentAt`.
 *
 * Asks for the row back so a write refused by row-level security is visible: without `.select()`
 * supabase-js answers `{data: null, error: null}` whether the row changed or nothing matched, and the
 * caller would report success while nothing was saved.
 */
export async function markPaymentPlanTaxInvoiceSent(
  target: TaxInvoiceTarget & { sentAt: string },
): Promise<MarkTaxInvoiceSentResult> {
  const planId = resolvePlanId(target);
  const failed = (error?: string): MarkTaxInvoiceSentResult => ({
    ok: false,
    sent: false,
    sentAt: null,
    sentByEmployeeId: null,
    error,
  });
  if (planId == null) return failed('this payment row has no id to write against');

  const employeeId = await resolveActorEmployeeId();
  const { data, error } = await supabase
    .from(resolveTable(target))
    .update({
      tax_invoice_sent: true,
      tax_invoice_sent_at: target.sentAt,
      tax_invoice_sent_by: employeeId,
    })
    .eq('id', planId)
    .select('tax_invoice_sent, tax_invoice_sent_at, tax_invoice_sent_by');

  if (error || !data || data.length === 0) {
    if (error) console.error('markPaymentPlanTaxInvoiceSent:', error.message);
    return failed(
      error?.message ?? 'the database accepted the request but changed no row, so nothing was saved',
    );
  }

  return { ok: true, ...paymentPlanTaxInvoiceState(data[0]) };
}

/** Undo a manual mark, so a row marked by mistake can go back to showing the automated state. */
export async function clearPaymentPlanTaxInvoiceSent(
  target: TaxInvoiceTarget,
): Promise<MarkTaxInvoiceSentResult> {
  const planId = resolvePlanId(target);
  const failed = (error?: string): MarkTaxInvoiceSentResult => ({
    ok: false,
    sent: false,
    sentAt: null,
    sentByEmployeeId: null,
    error,
  });
  if (planId == null) return failed('this payment row has no id to write against');

  const { data, error } = await supabase
    .from(resolveTable(target))
    .update({ tax_invoice_sent: false, tax_invoice_sent_at: null, tax_invoice_sent_by: null })
    .eq('id', planId)
    .select('id');

  if (error || !data || data.length === 0) {
    if (error) console.error('clearPaymentPlanTaxInvoiceSent:', error.message);
    return failed(
      error?.message ?? 'the database accepted the request but changed no row, so nothing was saved',
    );
  }

  return { ok: true, sent: false, sentAt: null, sentByEmployeeId: null };
}
