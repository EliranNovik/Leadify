import {
  fetchInvoicedInstallments,
  sumContributionIncomeNisInRange,
  sumInvoicedNisInRange,
} from './invoicedInstallments';

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

/**
 * Income base in NIS for the contribution report, for payments due in [fromDateStr, toDateStr].
 *
 * Same installments and same window as `fetchInvoicedTotalDueNisForDateRange`, but from October 2026
 * only those whose invoice was actually sent count — see `sumContributionIncomeNisInRange`.
 *
 * Kept separate from the due-based total on purpose: that one feeds the Dashboard Invoiced scoreboard
 * and the Sales contribution report, which must keep reporting everything that fell due.
 */
export async function fetchContributionIncomeNisForDateRange(
  fromDateStr: string,
  toDateStr: string,
): Promise<number> {
  const breakdown = await fetchContributionIncomeBreakdownNisForDateRange(fromDateStr, toDateStr);
  return breakdown.total;
}

export type ContributionIncomeBreakdown = {
  total: number;
  germanAustrian: number;
  other: number;
};

function isGermanOrAustrianCitizenship(mainCategoryName: string | null): boolean {
  const normalized = String(mainCategoryName || '').trim().toLowerCase();
  return (
    normalized === 'germany' ||
    normalized === 'austria' ||
    normalized === 'germany & austria' ||
    normalized === 'german\\austrian' ||
    normalized === 'german/austrian' ||
    normalized === 'german citizenship' ||
    normalized === 'austrian citizenship'
  );
}

/** Contribution income split for the category-dependent Sales / Handlers allocation rules. */
export async function fetchContributionIncomeBreakdownNisForDateRange(
  fromDateStr: string,
  toDateStr: string,
): Promise<ContributionIncomeBreakdown> {
  const rangeStart = normalizeDateOnly(fromDateStr);
  const rangeEnd = normalizeDateOnly(toDateStr);
  if (!rangeStart || !rangeEnd || rangeStart > rangeEnd) {
    return { total: 0, germanAustrian: 0, other: 0 };
  }

  try {
    const { installments } = await fetchInvoicedInstallments({
      dueFrom: rangeStart,
      dueTo: rangeEnd,
      // An invoiced row that was never flagged ready to pay is still income from October on.
      includeInvoiceSentNotReadyToPay: true,
    });
    const germanAustrianRows = installments.filter((row) =>
      isGermanOrAustrianCitizenship(row.mainCategoryName),
    );
    const otherRows = installments.filter(
      (row) => !isGermanOrAustrianCitizenship(row.mainCategoryName),
    );
    const total = sumContributionIncomeNisInRange(installments, rangeStart, rangeEnd);
    const germanAustrian = sumContributionIncomeNisInRange(germanAustrianRows, rangeStart, rangeEnd);
    const otherCalculated = sumContributionIncomeNisInRange(otherRows, rangeStart, rangeEnd);
    const other = Math.max(0, total - germanAustrian);
    return {
      total,
      germanAustrian,
      other: Number.isFinite(other) ? other : otherCalculated,
    };
  } catch (e) {
    console.error('fetchContributionIncomeBreakdownNisForDateRange failed:', e);
    return { total: 0, germanAustrian: 0, other: 0 };
  }
}
