import { supabase } from './supabase';
import {
  EXPENSE_CATEGORY_ORDER,
  fetchAllExpensesBreakdown,
  formatNis,
  marketingExpenseTotal,
  monthKeysForYearMonth,
  sumCategoryTotals,
} from './allExpensesReport';

export type FinanceOverviewSnapshot = {
  expensesThisMonthNis: number;
  expensesMarketingNis: number;
  expensesSalariesNis: number;
  overdueUnpaidCount: number;
  dueTodayCount: number;
  dueNext7DaysCount: number;
  readyToPayUnpaidCount: number;
  pendingWithProformaCount: number;
  pendingWithoutProformaCount: number;
  collectedTodayCount: number;
  collectedThisMonthCount: number;
  asOf: string;
};

export type FinancePaymentTrendPoint = {
  /** Calendar day key YYYY-MM-DD */
  monthKey: string;
  label: string;
  paid: number;
  pendingWithProforma: number;
  pendingWithoutProforma: number;
  /** Proformas / invoices created (or sent) that day */
  invoiceCreated: number;
};

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

function monthStartIso(d = new Date()): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`;
}

function dayKeyFromDate(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function dayLabelFromKey(dayKey: string): string {
  const [y, m, day] = dayKey.split('-').map(Number);
  if (!y || !m || !day) return dayKey;
  return new Date(y, m - 1, day).toLocaleString('en-GB', { day: 'numeric', month: 'short' });
}

function lastNDayKeys(n: number, from = new Date()): string[] {
  const keys: string[] = [];
  for (let i = n - 1; i >= 0; i -= 1) {
    const d = new Date(from.getFullYear(), from.getMonth(), from.getDate() - i);
    keys.push(dayKeyFromDate(d));
  }
  return keys;
}

function dateToDayKey(value: unknown): string | null {
  if (value == null || value === '') return null;
  const s = String(value).trim();
  if (!s) return null;
  const d = new Date(s.length <= 10 ? `${s}T12:00:00` : s);
  if (Number.isNaN(d.getTime())) return null;
  return dayKeyFromDate(d);
}

function hasProformaValue(value: unknown): boolean {
  if (value === null || value === undefined) return false;
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed || trimmed.toLowerCase() === 'null' || trimmed === '{}') return false;
    try {
      const parsed = JSON.parse(trimmed);
      if (parsed && typeof parsed === 'object' && Object.keys(parsed).length === 0) {
        return false;
      }
    } catch {
      // treat as truthy string
    }
    return true;
  }
  if (typeof value === 'object') {
    return Object.keys(value as object).length > 0;
  }
  return Boolean(value);
}

function isPaymentPaid(row: { paid?: unknown; paid_at?: unknown; actual_date?: unknown }): boolean {
  if (row.actual_date != null && String(row.actual_date).trim()) return true;
  if (row.paid === true || row.paid === 'true' || row.paid === 1 || row.paid === '1') return true;
  if (row.paid_at != null && String(row.paid_at).trim()) return true;
  return false;
}

async function countNewPlans(opts: {
  unpaidOnly?: boolean;
  dueOn?: string;
  dueBefore?: string;
  dueFrom?: string;
  dueTo?: string;
  paidFrom?: string;
  paidTo?: string;
  readyToPay?: boolean;
  /** true = proforma present; false = proforma null */
  withProforma?: boolean;
}): Promise<number> {
  let query = supabase.from('payment_plans').select('id', { count: 'exact', head: true });

  if (opts.unpaidOnly) {
    query = query.or('paid.is.null,paid.eq.false');
  }
  if (opts.dueOn) {
    query = query.eq('due_date', opts.dueOn);
  }
  if (opts.dueBefore) {
    query = query.lt('due_date', opts.dueBefore);
  }
  if (opts.dueFrom) {
    query = query.gte('due_date', opts.dueFrom);
  }
  if (opts.dueTo) {
    query = query.lte('due_date', opts.dueTo);
  }
  if (opts.paidFrom && opts.paidTo) {
    query = query.eq('paid', true).gte('paid_at', opts.paidFrom).lte('paid_at', `${opts.paidTo}T23:59:59`);
  }
  if (opts.readyToPay === true) {
    query = query.eq('ready_to_pay', true);
  }
  if (opts.withProforma === true) {
    query = query.not('proforma', 'is', null);
  } else if (opts.withProforma === false) {
    query = query.is('proforma', null);
  }

  const { count, error } = await query;
  if (error) {
    console.warn('Finance overview payment_plans count:', error.message);
    return 0;
  }
  return count ?? 0;
}

async function countLegacyPlans(opts: {
  unpaidOnly?: boolean;
  dueOn?: string;
  dueBefore?: string;
  dueFrom?: string;
  dueTo?: string;
  paidFrom?: string;
  paidTo?: string;
  readyToPay?: boolean;
}): Promise<number> {
  let query = supabase
    .from('finances_paymentplanrow')
    .select('id', { count: 'exact', head: true })
    .is('cancel_date', null);

  if (opts.unpaidOnly) {
    query = query.is('actual_date', null);
  }
  if (opts.dueOn) {
    query = query.eq('due_date', opts.dueOn);
  }
  if (opts.dueBefore) {
    query = query.lt('due_date', opts.dueBefore);
  }
  if (opts.dueFrom) {
    query = query.gte('due_date', opts.dueFrom);
  }
  if (opts.dueTo) {
    query = query.lte('due_date', opts.dueTo);
  }
  if (opts.paidFrom && opts.paidTo) {
    query = query.not('actual_date', 'is', null).gte('actual_date', opts.paidFrom).lte('actual_date', opts.paidTo);
  }
  if (opts.readyToPay === true) {
    query = query.eq('ready_to_pay', true);
  }

  const { count, error } = await query;
  if (error) {
    console.warn('Finance overview legacy plans count:', error.message);
    return 0;
  }
  return count ?? 0;
}

/** Lightweight KPIs for the Finance Management dashboard. */
export async function fetchFinanceManagementOverview(): Promise<FinanceOverviewSnapshot> {
  const today = todayIso();
  const monthStart = monthStartIso();
  const now = new Date();
  const year = String(now.getFullYear());
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const monthKeys = monthKeysForYearMonth(year, month);
  const in7 = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 7);
  const in7Iso = dayKeyFromDate(in7);
  // Tomorrow through +7 days (due today has its own card)
  const tomorrow = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
  const tomorrowIso = dayKeyFromDate(tomorrow);

  const [
    expenseRows,
    overdueNew,
    overdueLegacy,
    dueTodayNew,
    dueTodayLegacy,
    dueNext7New,
    dueNext7Legacy,
    readyNew,
    readyLegacy,
    pendingWithProforma,
    pendingWithoutProformaNew,
    pendingWithoutProformaLegacy,
    collectedTodayNew,
    collectedTodayLegacy,
    collectedNew,
    collectedLegacy,
  ] = await Promise.all([
    fetchAllExpensesBreakdown(monthKeys).catch(() => []),
    countNewPlans({ unpaidOnly: true, dueBefore: today }),
    countLegacyPlans({ unpaidOnly: true, dueBefore: today }),
    countNewPlans({ unpaidOnly: true, dueOn: today }),
    countLegacyPlans({ unpaidOnly: true, dueOn: today }),
    countNewPlans({ unpaidOnly: true, dueFrom: tomorrowIso, dueTo: in7Iso }),
    countLegacyPlans({ unpaidOnly: true, dueFrom: tomorrowIso, dueTo: in7Iso }),
    countNewPlans({ unpaidOnly: true, readyToPay: true }),
    countLegacyPlans({ unpaidOnly: true, readyToPay: true }),
    countNewPlans({ unpaidOnly: true, withProforma: true }),
    countNewPlans({ unpaidOnly: true, withProforma: false }),
    countLegacyPlans({ unpaidOnly: true }),
    countNewPlans({ paidFrom: today, paidTo: today }),
    countLegacyPlans({ paidFrom: today, paidTo: today }),
    countNewPlans({ paidFrom: monthStart, paidTo: today }),
    countLegacyPlans({ paidFrom: monthStart, paidTo: today }),
  ]);

  const totals = sumCategoryTotals(expenseRows);
  let expensesThisMonthNis = 0;
  for (const key of EXPENSE_CATEGORY_ORDER) {
    expensesThisMonthNis += totals[key] || 0;
  }

  return {
    expensesThisMonthNis,
    expensesMarketingNis: marketingExpenseTotal(totals),
    expensesSalariesNis: totals.salaries || 0,
    overdueUnpaidCount: overdueNew + overdueLegacy,
    dueTodayCount: dueTodayNew + dueTodayLegacy,
    dueNext7DaysCount: dueNext7New + dueNext7Legacy,
    readyToPayUnpaidCount: readyNew + readyLegacy,
    pendingWithProformaCount: pendingWithProforma,
    pendingWithoutProformaCount: pendingWithoutProformaNew + pendingWithoutProformaLegacy,
    collectedTodayCount: collectedTodayNew + collectedTodayLegacy,
    collectedThisMonthCount: collectedNew + collectedLegacy,
    asOf: today,
  };
}

const TREND_PAGE = 1000;

async function fetchAllPaged<T>(
  runPage: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>,
): Promise<T[]> {
  const rows: T[] = [];
  let from = 0;
  for (;;) {
    const to = from + TREND_PAGE - 1;
    const { data, error } = await runPage(from, to);
    if (error) throw error;
    const batch = data ?? [];
    rows.push(...batch);
    if (batch.length < TREND_PAGE) break;
    from += TREND_PAGE;
  }
  return rows;
}

function proformaCreatedDayKey(proforma: unknown): string | null {
  if (!hasProformaValue(proforma)) return null;
  try {
    const data = typeof proforma === 'string' ? JSON.parse(proforma) : proforma;
    const createdAt = (data as { createdAt?: unknown })?.createdAt;
    return dateToDayKey(createdAt);
  } catch {
    return null;
  }
}

/**
 * Daily trend for the finance dashboard line chart (last `dayCount` days).
 * - Paid: rows marked paid on that calendar day
 * - Pending with/without proforma: unpaid rows with due date on that day
 * - Invoice created: proforma invoices created / automation invoices sent that day
 */
export async function fetchFinancePaymentTrend(
  dayCount = 30,
): Promise<FinancePaymentTrendPoint[]> {
  const dayKeys = lastNDayKeys(dayCount);
  const rangeStart = dayKeys[0];
  const rangeEnd = dayKeys[dayKeys.length - 1];
  const monthPrefixes = [...new Set(dayKeys.map((k) => k.slice(0, 7)))];

  const empty = Object.fromEntries(
    dayKeys.map((k) => [
      k,
      { paid: 0, pendingWithProforma: 0, pendingWithoutProforma: 0, invoiceCreated: 0 },
    ]),
  ) as Record<
    string,
    { paid: number; pendingWithProforma: number; pendingWithoutProforma: number; invoiceCreated: number }
  >;

  // Deduplicate invoice counts when the same modern plan is counted via sent_at and createdAt.
  const invoiceCountedIds = new Set<string>();

  try {
    const modernProformaOr = monthPrefixes.map((m) => `proforma.ilike.%${m}%`).join(',');

    const [
      paidModern,
      unpaidModern,
      paidLegacy,
      unpaidLegacy,
      legacyProformas,
      modernSent,
      modernProformaCandidates,
    ] = await Promise.all([
      fetchAllPaged<any>((from, to) =>
        supabase
          .from('payment_plans')
          .select('id, paid, paid_at, due_date, proforma, cancel_date')
          .eq('paid', true)
          .gte('paid_at', rangeStart)
          .lte('paid_at', `${rangeEnd}T23:59:59`)
          .range(from, to),
      ),
      fetchAllPaged<any>((from, to) =>
        supabase
          .from('payment_plans')
          .select('id, paid, paid_at, due_date, proforma, cancel_date')
          .or('paid.is.null,paid.eq.false')
          .gte('due_date', rangeStart)
          .lte('due_date', rangeEnd)
          .range(from, to),
      ),
      fetchAllPaged<any>((from, to) =>
        supabase
          .from('finances_paymentplanrow')
          .select('id, actual_date, due_date, cancel_date')
          .is('cancel_date', null)
          .not('actual_date', 'is', null)
          .gte('actual_date', rangeStart)
          .lte('actual_date', rangeEnd)
          .range(from, to),
      ),
      fetchAllPaged<any>((from, to) =>
        supabase
          .from('finances_paymentplanrow')
          .select('id, actual_date, due_date, cancel_date')
          .is('cancel_date', null)
          .is('actual_date', null)
          .gte('due_date', rangeStart)
          .lte('due_date', rangeEnd)
          .range(from, to),
      ),
      fetchAllPaged<any>((from, to) =>
        supabase
          .from('proformainvoice')
          .select('id, cdate, cxd_date')
          .is('cxd_date', null)
          .gte('cdate', rangeStart)
          .lte('cdate', `${rangeEnd}T23:59:59`)
          .range(from, to),
      ).catch(() =>
        fetchAllPaged<any>((from, to) =>
          supabase
            .from('proformainvoice')
            .select('id, cdate')
            .gte('cdate', rangeStart)
            .lte('cdate', `${rangeEnd}T23:59:59`)
            .range(from, to),
        ),
      ),
      fetchAllPaged<any>((from, to) =>
        supabase
          .from('payment_plans')
          .select('id, invoice_send_automation_sent_at')
          .not('invoice_send_automation_sent_at', 'is', null)
          .gte('invoice_send_automation_sent_at', rangeStart)
          .lte('invoice_send_automation_sent_at', `${rangeEnd}T23:59:59`)
          .range(from, to),
      ).catch(() => []),
      modernProformaOr
        ? fetchAllPaged<any>((from, to) =>
            supabase
              .from('payment_plans')
              .select('id, proforma')
              .not('proforma', 'is', null)
              .or(modernProformaOr)
              .range(from, to),
          ).catch(() => [])
        : Promise.resolve([]),
    ]);

    for (const row of paidModern) {
      if (row.cancel_date) continue;
      const key = dateToDayKey(row.paid_at);
      if (key && empty[key]) empty[key].paid += 1;
    }

    for (const row of unpaidModern) {
      if (row.cancel_date) continue;
      if (isPaymentPaid(row)) continue;
      const dueKey = dateToDayKey(row.due_date);
      if (!dueKey || !empty[dueKey]) continue;
      if (hasProformaValue(row.proforma)) empty[dueKey].pendingWithProforma += 1;
      else empty[dueKey].pendingWithoutProforma += 1;
    }

    for (const row of paidLegacy) {
      const key = dateToDayKey(row.actual_date);
      if (key && empty[key]) empty[key].paid += 1;
    }

    // Legacy unpaid rows have no proforma on the payment row — count as without.
    for (const row of unpaidLegacy) {
      const dueKey = dateToDayKey(row.due_date);
      if (!dueKey || !empty[dueKey]) continue;
      empty[dueKey].pendingWithoutProforma += 1;
    }

    for (const row of legacyProformas) {
      if (row.cxd_date) continue;
      const key = dateToDayKey(row.cdate);
      if (key && empty[key]) empty[key].invoiceCreated += 1;
    }

    for (const row of modernSent) {
      const id = `sent-${row.id}`;
      if (invoiceCountedIds.has(id)) continue;
      const key = dateToDayKey(row.invoice_send_automation_sent_at);
      if (!key || !empty[key]) continue;
      invoiceCountedIds.add(id);
      empty[key].invoiceCreated += 1;
    }

    for (const row of modernProformaCandidates) {
      const id = `created-${row.id}`;
      const sentId = `sent-${row.id}`;
      // Prefer sent_at day when both exist — skip createdAt duplicate for same plan.
      if (invoiceCountedIds.has(sentId) || invoiceCountedIds.has(id)) continue;
      const key = proformaCreatedDayKey(row.proforma);
      if (!key || !empty[key]) continue;
      invoiceCountedIds.add(id);
      empty[key].invoiceCreated += 1;
    }
  } catch (err) {
    console.warn('Finance payment trend:', err);
  }

  return dayKeys.map((dayKey) => ({
    monthKey: dayKey,
    label: dayLabelFromKey(dayKey),
    paid: empty[dayKey]?.paid ?? 0,
    pendingWithProforma: empty[dayKey]?.pendingWithProforma ?? 0,
    pendingWithoutProforma: empty[dayKey]?.pendingWithoutProforma ?? 0,
    invoiceCreated: empty[dayKey]?.invoiceCreated ?? 0,
  }));
}

export { formatNis };
