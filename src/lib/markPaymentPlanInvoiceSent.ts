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

/**
 * Today in Jerusalem, as `YYYY-MM-DD`.
 *
 * Not `toISOString()`: between midnight and 03:00 local that reports yesterday in UTC, which would
 * file an invoice sent on the 1st of the month under the previous month. Inlined rather than imported
 * so sending an invoice does not pull in the clock-in module that owns the other copy.
 */
function jerusalemTodayDateKey(date = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Jerusalem',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date);
}

/**
 * The signed-in user, for stamping who sent the invoice.
 *
 * Forgiving by design: a missing employee id must not stop the invoice from being recorded as sent, so
 * every failure path yields nulls rather than throwing.
 */
async function resolveInvoiceSentActor(): Promise<{ employeeId: number | null; userName: string }> {
  const fallback = { employeeId: null, userName: 'System User' };
  try {
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user?.id) return fallback;

    const select = 'employee_id, full_name, email';
    let { data: row } = await supabase.from('users').select(select).eq('auth_id', user.id).maybeSingle();
    if ((row?.employee_id == null || row.employee_id === '') && user.email) {
      const { data: byEmail } = await supabase.from('users').select(select).eq('email', user.email).maybeSingle();
      if (byEmail) row = byEmail;
    }

    const rawId = row?.employee_id;
    const parsedId = rawId == null || rawId === '' ? NaN : Number(rawId);
    return {
      employeeId: Number.isFinite(parsedId) ? parsedId : null,
      userName:
        String(row?.full_name ?? '').trim() ||
        String(row?.email ?? '').trim() ||
        user.email ||
        fallback.userName,
    };
  } catch {
    return fallback;
  }
}

export type PaymentPlanInvoiceSentResult = {
  /** Timestamp recorded as the invoice send time. */
  sentAt: string;
  /** Whether this call also flipped the row to sent to finance. False if it already was. */
  markedReadyToPay: boolean;
  /** Due date written when marking, so a caller can patch its local row without refetching. */
  dueDate: string | null;
};

type MarkInvoiceSentInput = Pick<
  ProformaSendEmailInput,
  'kind' | 'recordId' | 'paymentPlanId' | 'isLegacyLead' | 'leadId'
>;

/**
 * Record a successful invoice send: `invoice_sent` plus the sent-to-finance stamp.
 *
 * Sending the invoice *is* sending it to finance, so both happen here rather than at each call site.
 * Before this, a row invoiced from anywhere that did not separately press "Sent to finance" kept
 * `ready_to_pay = false`, and every report gating on that flag silently dropped the money.
 *
 * A row already marked, paid, or cancelled keeps its existing stamp — only `invoice_sent` is written —
 * so re-sending an invoice never re-dates a payment that finance has already picked up.
 */
export async function markPaymentPlanInvoiceSent(
  input: MarkInvoiceSentInput,
): Promise<PaymentPlanInvoiceSentResult> {
  const sentAt = new Date().toISOString();
  const planId = resolveInvoiceSentPlanId(input);
  if (planId == null) return { sentAt, markedReadyToPay: false, dueDate: null };

  const table = resolveInvoiceSentTable(input);
  const isLegacy = table === 'finances_paymentplanrow';
  const today = jerusalemTodayDateKey();
  const actor = await resolveInvoiceSentActor();

  // Same field set the "Sent to finance" button writes, and the invoice automation after it.
  const readyToPayFields: Record<string, unknown> = { ready_to_pay: true, due_date: today };
  if (isLegacy) readyToPayFields.date = today;
  if (actor.employeeId != null) {
    readyToPayFields.ready_to_pay_by = actor.employeeId;
    if (isLegacy) readyToPayFields.due_by_id = actor.employeeId;
  }

  /*
   * One guarded write does both jobs and reports whether it marked anything.
   *
   * The guard lives in the filter rather than a read-then-write so two concurrent sends cannot both
   * decide the row was unmarked and double-stamp it. Paid and cancelled rows are excluded as well:
   * re-dating money that has already landed would move it into the wrong reporting period.
   */
  /*
   * `IS NOT TRUE` rather than `.or('ready_to_pay.is.null,ready_to_pay.eq.false')`: PostgREST
   * table-qualifies the conditions inside an `or` group, and that qualifier is out of scope in
   * the UPDATE it generates, so the whole statement failed with 42703 and nothing was ever
   * marked. A plain negated filter covers both NULL and false and renders correctly.
   */
  const guarded = supabase
    .from(table)
    .update({ invoice_sent: true, invoice_sent_at: sentAt, ...readyToPayFields })
    .eq('id', planId)
    .not('ready_to_pay', 'is', true)
    .is('cancel_date', null);

  // Each table records payment differently: new leads carry a `paid` flag, while legacy rows have no
  // such column at all and record the day the money landed in `actual_date`. Asking for the wrong one
  // fails the whole statement, which would quietly leave every legacy row unmarked.
  const { data: marked, error: markError } = await (
    isLegacy ? guarded.is('actual_date', null) : guarded.not('paid', 'is', true)
  ).select('id');

  if (markError) {
    console.warn(`markPaymentPlanInvoiceSent ready_to_pay (${table}#${planId}):`, markError.message);
  }
  const markedReadyToPay = !markError && (marked?.length ?? 0) > 0;

  if (!markedReadyToPay) {
    // Already marked, paid, cancelled, or the write failed: record the send and leave the rest alone.
    const { error } = await supabase
      .from(table)
      .update({ invoice_sent: true, invoice_sent_at: sentAt })
      .eq('id', planId);
    if (error) {
      console.warn(`markPaymentPlanInvoiceSent (${table}#${planId}):`, error.message);
    }
    return { sentAt, markedReadyToPay: false, dueDate: null };
  }

  // Mirrors the button and the automation: new leads get an audit trail, legacy rows never had one.
  if (!isLegacy && input.leadId) {
    const { error } = await supabase.from('finance_changes_history').insert({
      lead_id: input.leadId,
      change_type: 'payment_marked_ready_to_pay',
      table_name: 'payment_plans',
      record_id: planId,
      old_values: { ready_to_pay: false },
      new_values: { ready_to_pay: true, ready_to_pay_by: actor.employeeId },
      changed_by: actor.userName,
      notes: `Payment marked as ready to pay automatically when the invoice was sent by ${actor.userName}`,
    });
    if (error) {
      console.warn(`markPaymentPlanInvoiceSent history (payment_plans#${planId}):`, error.message);
    }
  }

  return { sentAt, markedReadyToPay: true, dueDate: today };
}
