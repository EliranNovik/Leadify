/**
 * The "Due / Invoiced" rule for the Simple Contribution report.
 *
 * One rule, two consumers: the per-employee Due / Invoiced column and the report's Total income are
 * the same money measured the same way, so both go through here. Before October 2026 a row counts
 * because it fell due; from October 2026 it counts because its invoice was actually sent, and it is
 * dated by the day that invoice went out rather than the day it falls due — see
 * `dueInvoicedIncomeDate`.
 *
 * Deliberately scoped to this report. The Dashboard Invoiced scoreboard and `SalesContributionPage`
 * keep the pure due-based measure, so nothing here may be wired into their queries.
 */
import { toDateOnlyKey } from '../lib/boiCurrencyConversion';
import {
  isPaymentPlanInvoiceSent,
  resolveInvoiceSentAt,
} from '../lib/markPaymentPlanInvoiceSent';
import {
  INVOICE_SENT_INCOME_START_DATE,
  incomeWindowOrFilter,
} from '../lib/invoicedInstallments';

/**
 * Columns the rule needs, on top of whatever amount/currency columns a query already selects.
 *
 * Both payment tables carry all four, so one string serves both.
 */
export const DUE_INVOICED_EXTRA_COLUMNS =
  'ready_to_pay, invoice_sent, invoice_sent_at, invoice_send_automation_sent_at';

/**
 * Same, plus the two legacy-only columns: the planned `date` and the day the money landed.
 *
 * `payment_plans` has neither, so this must only go into `finances_paymentplanrow` selects — it
 * records payment as `paid` / `paid_at` instead, and asking it for these fails the whole statement.
 *
 * `actual_date` is needed even though nothing filters on it: it is what anchors a paid row's currency
 * conversion to the day it was paid rather than the day it fell due.
 */
export const DUE_INVOICED_LEGACY_EXTRA_COLUMNS = `${DUE_INVOICED_EXTRA_COLUMNS}, date, actual_date`;

/**
 * The new-lead columns that anchor a paid row's currency conversion, for a query that counts paid rows.
 *
 * Mirrors `actual_date` on the legacy side. Without these a paid row converts at its due date, which
 * quietly disagrees with every other path that reads `paid_at`.
 */
export const DUE_INVOICED_PAID_COLUMNS = 'paid, paid_at';

/** The three columns that each record an invoice having been sent, as a PostgREST `or` list. */
const INVOICE_SENT_OR_FILTER =
  'invoice_sent.eq.true,invoice_sent_at.not.is.null,invoice_send_automation_sent_at.not.is.null';

/**
 * Stand-in for `.eq('ready_to_pay', true)` on a Due / Invoiced query.
 *
 * Marking an invoice sent does not reliably set `ready_to_pay`, so the plain equality drops rows that
 * really were invoiced. This widens the fetch to either flag and leaves the actual decision to
 * `countsTowardDueInvoiced`, which still requires `ready_to_pay` for pre-cutover rows.
 */
export function scopeDueInvoicedQuery<T extends { or: (filter: string) => T }>(query: T): T {
  return query.or(`ready_to_pay.eq.true,${INVOICE_SENT_OR_FILTER}`);
}

/**
 * Narrow a legacy query to rows invoiced in the window that never got a due date.
 *
 * A legacy row holds only its planned `date` until someone sends it to finance, which is what fills in
 * `due_date`. An invoice can go out well before that, so these rows are real invoiced income that the
 * due-date-filtered queries cannot see. They are anchored on `date` instead.
 *
 * Fetch these *in addition to* the normal due-date query, never instead of it, and keep passing the
 * same predicate: `countsTowardDueInvoiced` drops them for pre-cutover periods, where a row that never
 * fell due was never counted.
 *
 * Windowed on either the planned `date` or the day the invoice went out, for the same reason
 * `applyDueInvoicedWindow` is: from the cutover it is the invoice date that places the row.
 */
export function scopeLegacyInvoicedWithoutDueDate<
  T extends {
    is: (column: string, value: null) => T;
    not: (column: string, operator: string, value: unknown) => T;
    or: (filter: string) => T;
  },
>(query: T, from?: string | null, to?: string | null): T {
  const scoped = query.is('due_date', null).not('date', 'is', null).or(INVOICE_SENT_OR_FILTER);
  // `date` stands in for the due date on these rows, which have none yet.
  const filter = incomeWindowOrFilter('date', from, to);
  return filter ? scoped.or(filter) : scoped;
}

/** Date-only form of whatever a caller passes as a window bound: ISO timestamp or YYYY-MM-DD. */
function boundDay(value?: string | null): string {
  return String(value || '').slice(0, 10);
}

/**
 * The day one payment row's income falls on.
 *
 * From the cutover a row is dated by the day its invoice actually went out, which is the same day the
 * Dashboard Invoiced scoreboard files it under. That is the point of the measure: income is recognised
 * when the client is billed, not when the installment happens to come due.
 *
 * A row whose invoice went out *before* the cutover keeps its due date. Re-dating it would move it into
 * a period that was closed on the due-date rule, where nothing would count it — and there are a few
 * hundred such rows, invoiced in bulk before the cutover and falling due over the following years.
 *
 * Returns null when the row carries no date that can place it.
 */
export function dueInvoicedIncomeDate(
  payment: any,
  invoiceSentFrom: string = INVOICE_SENT_INCOME_START_DATE,
): string | null {
  const cutover = boundDay(invoiceSentFrom);
  const sentDate = toDateOnlyKey(resolveInvoiceSentAt(payment));
  if (sentDate && cutover && sentDate >= cutover) return sentDate;
  // Legacy rows hold only their planned `date` until someone sends them to finance.
  return toDateOnlyKey(payment?.due_date) || toDateOnlyKey(payment?.date) || null;
}

/**
 * Whether one payment row counts toward Due / Invoiced, ignoring the reporting window.
 *
 * `requireReadyToPay` reflects what the caller's query asked for before the cutover: the handler-pool
 * queries gate on `ready_to_pay`, the legacy all-leads ones never did, and that difference has to
 * survive unchanged for pre-October periods.
 *
 * A legacy row with no `due_date` is placed by its planned `date` instead, so an invoice sent before
 * the row reached finance still counts. Such a row is only ever counted from the cutover on: before it
 * the measure was purely "did this fall due", and a row with no due date did not.
 */
export function countsTowardDueInvoiced(
  payment: any,
  options: { requireReadyToPay: boolean; invoiceSentFrom?: string },
): boolean {
  const cutover = boundDay(options.invoiceSentFrom ?? INVOICE_SENT_INCOME_START_DATE);

  // Dated by the day its invoice went out, so having been sent is the entire condition.
  const sentDate = toDateOnlyKey(resolveInvoiceSentAt(payment));
  if (sentDate && cutover && sentDate >= cutover) return true;

  const scheduledDate = toDateOnlyKey(payment?.due_date);
  const effectiveDate = scheduledDate || toDateOnlyKey(payment?.date);
  if (!effectiveDate) return false;

  if (cutover && effectiveDate >= cutover) {
    return isPaymentPlanInvoiceSent(payment);
  }
  if (!scheduledDate) return false;
  return options.requireReadyToPay ? Boolean(payment?.ready_to_pay) : true;
}

/** The reporting window a Due / Invoiced figure covers. Bounds may be ISO timestamps or YYYY-MM-DD. */
export type DueInvoicedWindow = { from?: string | null; to?: string | null };

/** Whether a row's income date — not its due date — lands inside the window. */
export function isDueInvoicedInWindow(
  payment: any,
  window: DueInvoicedWindow,
  invoiceSentFrom?: string,
): boolean {
  const date = dueInvoicedIncomeDate(payment, invoiceSentFrom);
  if (!date) return false;
  const from = boundDay(window.from);
  const to = boundDay(window.to);
  if (from && date < from) return false;
  if (to && date > to) return false;
  return true;
}

/**
 * The predicate the payment processors apply: counts, and falls in the window.
 *
 * A factory rather than a bare function because the window is now part of the decision. The widened
 * SQL below deliberately returns rows from outside it — a row invoiced in October but due next March
 * comes back from the same query as one invoiced last March and due in October — and only the income
 * date separates them.
 */
export function dueInvoicedFilter(options: {
  requireReadyToPay: boolean;
  window: DueInvoicedWindow;
  invoiceSentFrom?: string;
}): (payment: any) => boolean {
  return (payment: any) =>
    isDueInvoicedInWindow(payment, options.window, options.invoiceSentFrom) &&
    countsTowardDueInvoiced(payment, options);
}

/** Ready-made predicate for the processors, for a query that gated on `ready_to_pay`. */
export const dueInvoicedReadyToPayFilter = (window: DueInvoicedWindow) =>
  dueInvoicedFilter({ requireReadyToPay: true, window });

/** Ready-made predicate for a query that never gated on `ready_to_pay`. */
export const dueInvoicedAllRowsFilter = (window: DueInvoicedWindow) =>
  dueInvoicedFilter({ requireReadyToPay: false, window });

/**
 * Restrict a Due / Invoiced query to the reporting window.
 *
 * Replaces a plain `due_date` between-filter, which cannot express this measure: from the cutover a
 * row belongs to the window because its *invoice* went out inside it, and its due date may be years
 * away. So the fetch has to accept either anchor and let `dueInvoicedFilter` settle which rows
 * actually count — this is a superset on purpose.
 *
 * The invoice-date arms never reach back before the cutover, because a row invoiced earlier than that
 * is still dated by its due date and the due-date arm already covers it.
 */
export function applyDueInvoicedWindow<T extends { or: (filter: string) => T }>(
  query: T,
  window: DueInvoicedWindow,
  invoiceSentFrom?: string,
): T {
  const filter = incomeWindowOrFilter('due_date', window.from, window.to, invoiceSentFrom);
  return filter ? query.or(filter) : query;
}
