/**
 * The "Due / Invoiced" rule for the Simple Contribution report.
 *
 * One rule, two consumers: the per-employee Due / Invoiced column and the report's Total income are
 * the same money measured the same way, so both go through here. Before October 2026 a row counts
 * because it fell due; from October 2026 it counts because its invoice was actually sent.
 *
 * Deliberately scoped to this report. The Dashboard Invoiced scoreboard and `SalesContributionPage`
 * keep the pure due-based measure, so nothing here may be wired into their queries.
 */
import { toDateOnlyKey } from '../lib/boiCurrencyConversion';
import { isPaymentPlanInvoiceSent } from '../lib/markPaymentPlanInvoiceSent';
import { INVOICE_SENT_INCOME_START_DATE } from '../lib/invoicedInstallments';

/**
 * Columns the rule needs, on top of whatever amount/currency columns a query already selects.
 *
 * Both payment tables carry all four, so one string serves both.
 */
export const DUE_INVOICED_EXTRA_COLUMNS =
  'ready_to_pay, invoice_sent, invoice_sent_at, invoice_send_automation_sent_at';

/**
 * Same, plus the legacy-only planned `date`.
 *
 * `payment_plans` has no such column, so this must only go into `finances_paymentplanrow` selects.
 */
export const DUE_INVOICED_LEGACY_EXTRA_COLUMNS = `${DUE_INVOICED_EXTRA_COLUMNS}, date`;

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
 */
export function scopeLegacyInvoicedWithoutDueDate<
  T extends {
    is: (column: string, value: null) => T;
    not: (column: string, operator: string, value: unknown) => T;
    gte: (column: string, value: string) => T;
    lte: (column: string, value: string) => T;
    or: (filter: string) => T;
  },
>(query: T, from?: string | null, to?: string | null): T {
  let scoped = query.is('due_date', null).not('date', 'is', null).or(INVOICE_SENT_OR_FILTER);
  if (from) scoped = scoped.gte('date', from);
  if (to) scoped = scoped.lte('date', to);
  return scoped;
}

/**
 * Whether one payment row counts toward Due / Invoiced.
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
  const scheduledDate = toDateOnlyKey(payment?.due_date);
  const effectiveDate = scheduledDate || toDateOnlyKey(payment?.date);
  if (!effectiveDate) return false;

  const cutover = String(options.invoiceSentFrom ?? INVOICE_SENT_INCOME_START_DATE).split('T')[0];
  if (cutover && effectiveDate >= cutover) {
    return isPaymentPlanInvoiceSent(payment);
  }
  if (!scheduledDate) return false;
  return options.requireReadyToPay ? Boolean(payment?.ready_to_pay) : true;
}

/** Ready-made predicate for the processors, for a query that gated on `ready_to_pay`. */
export const dueInvoicedReadyToPayFilter = (payment: any): boolean =>
  countsTowardDueInvoiced(payment, { requireReadyToPay: true });

/** Ready-made predicate for a query that never gated on `ready_to_pay`. */
export const dueInvoicedAllRowsFilter = (payment: any): boolean =>
  countsTowardDueInvoiced(payment, { requireReadyToPay: false });
