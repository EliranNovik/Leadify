import { fetchInvoicedInstallments, sumInvoicedNisInRange } from './invoicedInstallments';

function normalizeDateOnly(s: string): string {
  if (!s || !String(s).trim()) return '';
  return String(s).trim().split('T')[0];
}

/**
 * Total invoiced "due" in NIS for payments whose `due_date` falls in [fromDateStr, toDateStr]
 * (inclusive, YYYY-MM-DD) — the same figure as the Dashboard Invoiced scoreboard's **Total**
 * column, because both now read from `fetchInvoicedInstallments`.
 *
 * This used to be a ~830 line copy of the Dashboard's logic and had drifted badly: its
 * `payment_plans` query was unpaginated (capped at one PostgREST page, with no ORDER BY, so the
 * rows it did get were arbitrary), it dropped installments whose category did not map to a
 * scoreboard department instead of counting them under "Other", it converted currency at the due
 * date even for already-paid rows, and it never subtracted subcontractor fees.
 */
export async function fetchInvoicedTotalDueNisForDateRange(
  fromDateStr: string,
  toDateStr: string,
): Promise<number> {
  const rangeStart = normalizeDateOnly(fromDateStr);
  const rangeEnd = normalizeDateOnly(toDateStr);
  if (!rangeStart || !rangeEnd || rangeStart > rangeEnd) {
    return 0;
  }

  try {
    const { installments } = await fetchInvoicedInstallments({
      dueFrom: rangeStart,
      dueTo: rangeEnd,
    });
    return sumInvoicedNisInRange(installments, rangeStart, rangeEnd);
    } catch (e) {
      console.error('fetchInvoicedTotalDueNisForDateRange failed:', e);
      return 0;
    }
}
