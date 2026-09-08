import {
  applyInvoiceSentFromPaymentRequest,
  countDueLast30DayFocus,
  countSignedLeadsMissingPaymentPlan,
  last7DaysRange,
  last30DaysRange,
} from './paymentRequestEmail';
import { supabase } from './supabase';
import {
  EXPENSE_CATEGORY_ORDER,
  fetchAllExpensesBreakdown,
  formatNis,
  marketingExpenseTotal,
  monthKeysForYearMonth,
  sumCategoryTotals,
} from './allExpensesReport';
import { getJerusalemDateFromTimestamp, getJerusalemTodayIsoDate } from './boiCurrencyConversion';
import { buildJerusalemEndOfDayIso, buildJerusalemStartOfDayIso } from './leadDateFilters';
import { formatLeadMoneyAmount, toLeadCurrencyIcon } from './leadCurrencyDisplay';
import { buildCalendarClientRoute } from './calendarClientRoute';
import { buildClientFinancesTabPath } from './proformaClientNavigation';
import {
  extractPelecardCodeFromText,
  formatPelecardHistoryStatus,
  isPelecardSessionExpiredCode,
} from './pelecardErrors';

export type FinanceOverviewSnapshot = {
  expensesThisMonthNis: number;
  expensesMarketingNis: number;
  expensesSalariesNis: number;
  overdueUnpaidCount: number;
  dueTodayCount: number;
  signedMissingPaymentPlanCount: number;
  dueUnsentProformaCount: number;
  dueSentProformaCount: number;
  dueNoProformaCount: number;
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

export type FinanceLastPaymentRow = {
  id: string;
  leadNumber: string;
  clientName: string;
  currencySign: string;
  amountNumber: string;
  amountLabel: string;
  paidBy: string;
  href: string;
  paidAt: string;
};

export type FinanceFailedPaymentRow = {
  id: string;
  leadNumber: string;
  clientName: string;
  currencySign: string;
  amountNumber: string;
  amountLabel: string;
  errorReason: string;
  href: string;
  failedAt: string;
};

export type FinanceInvoiceInstructionKind = 'create_proforma' | 'send_invoice';

export type FinanceInvoiceInstructionRow = {
  id: string;
  kind: FinanceInvoiceInstructionKind;
  leadNumber: string;
  clientName: string;
  currencySign: string;
  amountNumber: string;
  amountLabel: string;
  dueDate: string;
  dueLabel: string;
  daysAgo: number;
  orderLabel: string;
  href: string;
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
  const last30 = last30DaysRange();
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
    signedMissingPaymentPlanCount,
    dueLast30,
  ] = await Promise.all([
    fetchAllExpensesBreakdown(monthKeys).catch(() => []),
    countNewPlans({ unpaidOnly: true, dueFrom: last30.from, dueBefore: today }),
    countLegacyPlans({ unpaidOnly: true, dueFrom: last30.from, dueBefore: today }),
    countNewPlans({ unpaidOnly: true, dueOn: today }),
    countLegacyPlans({ unpaidOnly: true, dueOn: today }),
    countNewPlans({ unpaidOnly: true, dueFrom: tomorrowIso, dueTo: in7Iso }),
    countLegacyPlans({ unpaidOnly: true, dueFrom: tomorrowIso, dueTo: in7Iso }),
    countNewPlans({ unpaidOnly: true, readyToPay: true, dueFrom: last30.from, dueTo: last30.to }),
    countLegacyPlans({ unpaidOnly: true, readyToPay: true, dueFrom: last30.from, dueTo: last30.to }),
    countNewPlans({ unpaidOnly: true, withProforma: true, dueFrom: last30.from, dueTo: last30.to }),
    countNewPlans({ unpaidOnly: true, withProforma: false, dueFrom: last30.from, dueTo: last30.to }),
    countLegacyPlans({ unpaidOnly: true, dueFrom: last30.from, dueTo: last30.to }),
    countNewPlans({ paidFrom: today, paidTo: today }),
    countLegacyPlans({ paidFrom: today, paidTo: today }),
    countNewPlans({ paidFrom: monthStart, paidTo: today }),
    countLegacyPlans({ paidFrom: monthStart, paidTo: today }),
    countSignedLeadsMissingPaymentPlan(),
    countDueLast30DayFocus(),
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
    signedMissingPaymentPlanCount,
    dueUnsentProformaCount: dueLast30.unsent,
    dueSentProformaCount: dueLast30.sent,
    dueNoProformaCount: dueLast30.noProforma,
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

function parseMoney(value: unknown): number {
  const n = Number(String(value ?? '').replace(/[^0-9.-]/g, ''));
  return Number.isFinite(n) ? n : 0;
}

function toAmountParts(
  amount: number,
  currency?: string | number | null,
  currencyId?: number | null,
): Pick<FinanceLastPaymentRow, 'currencySign' | 'amountNumber' | 'amountLabel'> {
  if (!amount) {
    return { currencySign: '', amountNumber: '—', amountLabel: '—' };
  }
  const currencySign = toLeadCurrencyIcon(currency, currencyId);
  const amountNumber = Math.round(amount).toLocaleString('en-US');
  return {
    currencySign,
    amountNumber,
    amountLabel: formatLeadMoneyAmount(amount, currency, currencyId),
  };
}

function titleCaseWords(value: string): string {
  return value
    .split(/\s+/)
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}

/** Payment type for the dashboard — not the staff member who marked the row paid. */
export function formatFinancePaymentMethod(raw: string | null | undefined): string {
  const v = String(raw || '')
    .trim()
    .toLowerCase()
    .replace(/[_-]+/g, ' ');
  if (!v) return 'Manual payment';
  if (v.includes('manual')) return 'Manual payment';
  if (v.includes('bank') || v.includes('transfer') || v.includes('open finance') || v === 'bit') {
    return 'Bank transfer';
  }
  if (v.includes('credit') || v === 'cc' || v === 'card') return 'Credit card';
  if (v.includes('pelecard')) return 'Pelecard';
  if (v.includes('payper')) return 'Payper';
  return titleCaseWords(v);
}

async function fetchRowsInChunks<T>(
  ids: Array<string | number>,
  run: (chunk: Array<string | number>) => Promise<T[]>,
  chunkSize = 200,
): Promise<T[]> {
  const out: T[] = [];
  for (let i = 0; i < ids.length; i += chunkSize) {
    out.push(...(await run(ids.slice(i, i + chunkSize))));
  }
  return out;
}

type PaidLinkHint = {
  paymentPlanId: number;
  isLegacy: boolean;
  method: string | null;
  paidAt: string;
};

async function fetchPaidMethodHints(opts: {
  modernPlanIds: number[];
  legacyPlanIds: number[];
}): Promise<Map<string, PaidLinkHint>> {
  const hints = new Map<string, PaidLinkHint>();
  const allIds = [...new Set([...opts.modernPlanIds, ...opts.legacyPlanIds])];
  if (!allIds.length) return hints;

  const links = await fetchRowsInChunks(allIds, async (chunk) => {
    const { data, error } = await supabase
      .from('payment_links')
      .select('id, payment_plan_id, payment_method, status, paid_at, client_id, legacy_id')
      .in('payment_plan_id', chunk);
    if (error) throw error;
    return data ?? [];
  });

  const paidLinks = links.filter((link) => {
    const status = String(link.status || '').toLowerCase();
    return status === 'paid' || status === 'success' || Boolean(link.paid_at);
  });

  const linkIds = paidLinks.map((link) => link.id).filter((id) => id != null);
  const txByLink = new Map<string, string>();
  if (linkIds.length) {
    const txs = await fetchRowsInChunks(linkIds, async (chunk) => {
      const { data, error } = await supabase
        .from('payment_transactions')
        .select('payment_link_id, payment_method, status, created_at, completed_at')
        .in('payment_link_id', chunk);
      if (error) throw error;
      return data ?? [];
    }).catch(() => []);
    const success = txs.filter((tx) => String(tx.status || '').toLowerCase() === 'success');
    success.sort((a, b) =>
      String(b.completed_at || b.created_at || '').localeCompare(String(a.completed_at || a.created_at || '')),
    );
    for (const tx of success) {
      const key = String(tx.payment_link_id ?? '');
      if (!key || txByLink.has(key)) continue;
      if (typeof tx.payment_method === 'string' && tx.payment_method.trim()) {
        txByLink.set(key, tx.payment_method.trim());
      }
    }
  }

  const modernSet = new Set(opts.modernPlanIds);
  const legacySet = new Set(opts.legacyPlanIds);

  for (const link of paidLinks) {
    const planId = Number(link.payment_plan_id);
    if (!Number.isFinite(planId)) continue;
    const isLegacy = link.legacy_id != null;
    if (isLegacy && !legacySet.has(planId)) continue;
    if (!isLegacy && !modernSet.has(planId)) continue;
    const key = `${isLegacy ? 'legacy' : 'new'}:${planId}`;
    const paidAt = String(link.paid_at || '');
    const existing = hints.get(key);
    if (existing && existing.paidAt && paidAt && existing.paidAt > paidAt) continue;
    const method =
      txByLink.get(String(link.id)) ||
      (typeof link.payment_method === 'string' && link.payment_method.trim()
        ? link.payment_method.trim()
        : 'pelecard');
    hints.set(key, { paymentPlanId: planId, isLegacy, method, paidAt });
  }

  return hints;
}

/** Today's collected payment-plan rows (Asia/Jerusalem), newest first. */
export async function fetchFinanceLastPaymentsToday(): Promise<FinanceLastPaymentRow[]> {
  const today = getJerusalemTodayIsoDate();
  const startIso = buildJerusalemStartOfDayIso(today);
  const endIso = buildJerusalemEndOfDayIso(today);

  const [modernRows, legacyRows] = await Promise.all([
    fetchAllPaged<any>((from, to) =>
      supabase
        .from('payment_plans')
        .select('id, lead_id, value, value_vat, currency, currency_id, paid_at, paid, client_name, cancel_date')
        .eq('paid', true)
        .not('paid_at', 'is', null)
        .gte('paid_at', startIso)
        .lte('paid_at', endIso)
        .order('paid_at', { ascending: false })
        .range(from, to),
    ),
    fetchAllPaged<any>((from, to) =>
      supabase
        .from('finances_paymentplanrow')
        .select('id, lead_id, client_id, value, value_base, vat_value, currency_id, actual_date, cancel_date')
        .is('cancel_date', null)
        .not('actual_date', 'is', null)
        .gte('actual_date', today)
        .lte('actual_date', today)
        .order('actual_date', { ascending: false })
        .range(from, to),
    ),
  ]);

  const modern = modernRows.filter(
    (row) =>
      !row.cancel_date &&
      getJerusalemDateFromTimestamp(row.paid_at) === today,
  );
  const legacy = legacyRows.filter((row) => getJerusalemDateFromTimestamp(row.actual_date) === today);

  const newLeadIds = [...new Set(modern.map((row) => String(row.lead_id || '')).filter(Boolean))];
  const legacyLeadIds = [
    ...new Set(legacy.map((row) => Number(row.lead_id)).filter((id) => Number.isFinite(id))),
  ];
  const legacyContactIds = [
    ...new Set(legacy.map((row) => Number(row.client_id)).filter((id) => Number.isFinite(id))),
  ];

  const modernPlanIds = modern.map((row) => Number(row.id)).filter((id) => Number.isFinite(id));
  const legacyPlanIds = legacy.map((row) => Number(row.id)).filter((id) => Number.isFinite(id));

  const [newLeads, legacyLeads, contacts, methodHints] = await Promise.all([
    newLeadIds.length
      ? fetchRowsInChunks(newLeadIds, async (chunk) => {
          const { data, error } = await supabase
            .from('leads')
            .select('id, name, lead_number, manual_id, anchor_full_name')
            .in('id', chunk);
          if (error) throw error;
          return data ?? [];
        })
      : Promise.resolve([]),
    legacyLeadIds.length
      ? fetchRowsInChunks(legacyLeadIds, async (chunk) => {
          const { data, error } = await supabase
            .from('leads_lead')
            .select('id, name, lead_number, manual_id, anchor_full_name')
            .in('id', chunk);
          if (error) throw error;
          return data ?? [];
        })
      : Promise.resolve([]),
    legacyContactIds.length
      ? fetchRowsInChunks(legacyContactIds, async (chunk) => {
          const { data, error } = await supabase
            .from('leads_contact')
            .select('id, name')
            .in('id', chunk);
          if (error) throw error;
          return data ?? [];
        }).catch(() => [])
      : Promise.resolve([]),
    fetchPaidMethodHints({ modernPlanIds, legacyPlanIds }).catch(() => new Map<string, PaidLinkHint>()),
  ]);

  const newLeadById = new Map(newLeads.map((lead) => [String(lead.id), lead]));
  const legacyLeadById = new Map(legacyLeads.map((lead) => [String(lead.id), lead]));
  const contactById = new Map(contacts.map((contact) => [String(contact.id), contact]));

  const rows: FinanceLastPaymentRow[] = [];

  for (const row of modern) {
    const lead = newLeadById.get(String(row.lead_id || ''));
    const leadNumber = String(lead?.lead_number || '').trim();
    const clientName =
      String(row.client_name || lead?.name || lead?.anchor_full_name || '').trim() || '—';
    const amount = parseMoney(row.value) + parseMoney(row.value_vat);
    const method = methodHints.get(`new:${Number(row.id)}`)?.method;
    rows.push({
      id: `new-${row.id}`,
      leadNumber,
      clientName,
      ...toAmountParts(amount, row.currency, row.currency_id),
      paidBy: formatFinancePaymentMethod(method),
      href: buildCalendarClientRoute({
        lead_type: 'new',
        lead_number: leadNumber || null,
        manual_id: lead?.manual_id ?? null,
        id: lead?.id ?? row.lead_id,
      }),
      paidAt: String(row.paid_at || ''),
    });
  }

  for (const row of legacy) {
    const lead = legacyLeadById.get(String(row.lead_id || ''));
    const contact = contactById.get(String(row.client_id || ''));
    const leadNumber = String(lead?.lead_number || row.lead_id || '').trim();
    const clientName =
      String(contact?.name || lead?.name || lead?.anchor_full_name || '').trim() || '—';
    const amount = parseMoney(row.value) || parseMoney(row.value_base) + parseMoney(row.vat_value);
    const method = methodHints.get(`legacy:${Number(row.id)}`)?.method;
    rows.push({
      id: `legacy-${row.id}`,
      leadNumber,
      clientName,
      ...toAmountParts(amount, null, row.currency_id),
      paidBy: formatFinancePaymentMethod(method),
      href: buildCalendarClientRoute({
        lead_type: 'legacy',
        lead_number: lead?.lead_number || null,
        manual_id: lead?.manual_id ?? null,
        id: lead?.id ?? row.lead_id,
      }),
      paidAt: String(row.actual_date || ''),
    });
  }

  rows.sort((a, b) => String(b.paidAt).localeCompare(String(a.paidAt)));
  return rows;
}

function isSessionExpiredFailure(opts: {
  errorMessage?: string | null;
  statusCode?: string | null;
}): boolean {
  const code = String(opts.statusCode || '').trim() || extractPelecardCodeFromText(opts.errorMessage);
  if (isPelecardSessionExpiredCode(code)) return true;
  const text = String(opts.errorMessage || '').toLowerCase();
  return text.includes('session expired') || text.includes('checkout session expired');
}

function failedPaymentReason(opts: {
  status?: string | null;
  errorMessage?: string | null;
  statusCode?: string | null;
}): string {
  const view = formatPelecardHistoryStatus({
    status: opts.status,
    statusCode: opts.statusCode || extractPelecardCodeFromText(opts.errorMessage),
    errorMessage: opts.errorMessage,
  });
  const title = String(view.title || '').trim();
  const raw = String(opts.errorMessage || '')
    .replace(/^\s*\[\d{3}\]\s*/, '')
    .trim();
  if (title && raw && raw.length <= 80 && !title.toLowerCase().includes(raw.toLowerCase())) {
    return `${title} · ${raw}`;
  }
  return title || raw || 'Payment failed';
}

/** Today's failed / cancelled payment-link attempts (Asia/Jerusalem), newest first. */
export async function fetchFinanceFailedPaymentsToday(): Promise<FinanceFailedPaymentRow[]> {
  const today = getJerusalemTodayIsoDate();
  const startIso = buildJerusalemStartOfDayIso(today);
  const endIso = buildJerusalemEndOfDayIso(today);

  const transactions = await fetchAllPaged<any>((from, to) =>
    supabase
      .from('payment_transactions')
      .select('id, payment_link_id, status, payment_method, amount, error_message, created_at, completed_at')
      .in('status', ['failed', 'cancelled', 'canceled'])
      .gte('created_at', startIso)
      .lte('created_at', endIso)
      .order('created_at', { ascending: false })
      .range(from, to),
  ).catch(() => []);

  const todayTx = transactions.filter((tx) => {
    if (getJerusalemDateFromTimestamp(tx.created_at || tx.completed_at) !== today) return false;
    return !isSessionExpiredFailure({
      errorMessage: tx.error_message,
      statusCode: extractPelecardCodeFromText(tx.error_message),
    });
  });

  const linkIds = [...new Set(todayTx.map((tx) => tx.payment_link_id).filter((id) => id != null))];
  const links = linkIds.length
    ? await fetchRowsInChunks(linkIds, async (chunk) => {
        const { data, error } = await supabase
          .from('payment_links')
          .select(
            'id, payment_plan_id, client_id, legacy_id, plan_contact_id, total_amount, currency, payment_method, status, pelecard_status_code',
          )
          .in('id', chunk);
        if (error) throw error;
        return data ?? [];
      }).catch(() => [])
    : [];

  const linkById = new Map(links.map((link) => [String(link.id), link]));

  const newLeadIds = [
    ...new Set(links.map((link) => (link.legacy_id == null && link.client_id != null ? String(link.client_id) : '')).filter(Boolean)),
  ];
  const legacyLeadIds = [
    ...new Set(links.map((link) => Number(link.legacy_id)).filter((id) => Number.isFinite(id))),
  ];
  const contactIds = [
    ...new Set(links.map((link) => Number(link.plan_contact_id)).filter((id) => Number.isFinite(id))),
  ];
  const modernPlanIds = [
    ...new Set(
      links
        .filter((link) => link.legacy_id == null)
        .map((link) => Number(link.payment_plan_id))
        .filter((id) => Number.isFinite(id)),
    ),
  ];
  const legacyPlanIds = [
    ...new Set(
      links
        .filter((link) => link.legacy_id != null)
        .map((link) => Number(link.payment_plan_id))
        .filter((id) => Number.isFinite(id)),
    ),
  ];

  const [newLeads, legacyLeads, contacts, modernPlans, legacyPlans] = await Promise.all([
    newLeadIds.length
      ? fetchRowsInChunks(newLeadIds, async (chunk) => {
          const { data, error } = await supabase
            .from('leads')
            .select('id, name, lead_number, manual_id, anchor_full_name')
            .in('id', chunk);
          if (error) throw error;
          return data ?? [];
        }).catch(() => [])
      : Promise.resolve([]),
    legacyLeadIds.length
      ? fetchRowsInChunks(legacyLeadIds, async (chunk) => {
          const { data, error } = await supabase
            .from('leads_lead')
            .select('id, name, lead_number, manual_id, anchor_full_name')
            .in('id', chunk);
          if (error) throw error;
          return data ?? [];
        }).catch(() => [])
      : Promise.resolve([]),
    contactIds.length
      ? fetchRowsInChunks(contactIds, async (chunk) => {
          const { data, error } = await supabase.from('leads_contact').select('id, name').in('id', chunk);
          if (error) throw error;
          return data ?? [];
        }).catch(() => [])
      : Promise.resolve([]),
    modernPlanIds.length
      ? fetchRowsInChunks(modernPlanIds, async (chunk) => {
          const { data, error } = await supabase
            .from('payment_plans')
            .select('id, lead_id, client_name')
            .in('id', chunk);
          if (error) throw error;
          return data ?? [];
        }).catch(() => [])
      : Promise.resolve([]),
    legacyPlanIds.length
      ? fetchRowsInChunks(legacyPlanIds, async (chunk) => {
          const { data, error } = await supabase
            .from('finances_paymentplanrow')
            .select('id, lead_id, client_id')
            .in('id', chunk);
          if (error) throw error;
          return data ?? [];
        }).catch(() => [])
      : Promise.resolve([]),
  ]);

  const extraNewLeadIds = [
    ...new Set(modernPlans.map((plan) => String(plan.lead_id || '')).filter(Boolean)),
  ].filter((id) => !newLeadIds.includes(id));
  const extraLegacyLeadIds = [
    ...new Set(legacyPlans.map((plan) => Number(plan.lead_id)).filter((id) => Number.isFinite(id))),
  ].filter((id) => !legacyLeadIds.includes(id));

  const [extraNewLeads, extraLegacyLeads] = await Promise.all([
    extraNewLeadIds.length
      ? fetchRowsInChunks(extraNewLeadIds, async (chunk) => {
          const { data, error } = await supabase
            .from('leads')
            .select('id, name, lead_number, manual_id, anchor_full_name')
            .in('id', chunk);
          if (error) throw error;
          return data ?? [];
        }).catch(() => [])
      : Promise.resolve([]),
    extraLegacyLeadIds.length
      ? fetchRowsInChunks(extraLegacyLeadIds, async (chunk) => {
          const { data, error } = await supabase
            .from('leads_lead')
            .select('id, name, lead_number, manual_id, anchor_full_name')
            .in('id', chunk);
          if (error) throw error;
          return data ?? [];
        }).catch(() => [])
      : Promise.resolve([]),
  ]);

  const newLeadById = new Map([...newLeads, ...extraNewLeads].map((lead) => [String(lead.id), lead]));
  const legacyLeadById = new Map(
    [...legacyLeads, ...extraLegacyLeads].map((lead) => [String(lead.id), lead]),
  );
  const contactById = new Map(contacts.map((contact) => [String(contact.id), contact]));
  const modernPlanById = new Map(modernPlans.map((plan) => [String(plan.id), plan]));
  const legacyPlanById = new Map(legacyPlans.map((plan) => [String(plan.id), plan]));

  const rows: FinanceFailedPaymentRow[] = [];
  for (const tx of todayTx) {
    const link = linkById.get(String(tx.payment_link_id ?? ''));
    if (
      isSessionExpiredFailure({
        errorMessage: tx.error_message,
        statusCode: link?.pelecard_status_code,
      })
    ) {
      continue;
    }
    const isLegacy = link?.legacy_id != null;
    const modernPlan = !isLegacy ? modernPlanById.get(String(link?.payment_plan_id ?? '')) : undefined;
    const legacyPlan = isLegacy ? legacyPlanById.get(String(link?.payment_plan_id ?? '')) : undefined;
    const leadId = isLegacy
      ? String(link?.legacy_id ?? legacyPlan?.lead_id ?? '')
      : String(link?.client_id ?? modernPlan?.lead_id ?? '');
    const lead = isLegacy ? legacyLeadById.get(leadId) : newLeadById.get(leadId);
    const contact = contactById.get(String(link?.plan_contact_id ?? legacyPlan?.client_id ?? ''));
    const leadNumber = String(lead?.lead_number || (isLegacy ? leadId : '')).trim();
    const clientName =
      String(
        contact?.name ||
          modernPlan?.client_name ||
          lead?.name ||
          lead?.anchor_full_name ||
          '',
      ).trim() || '—';
    const amount = parseMoney(tx.amount) || parseMoney(link?.total_amount);
    const href =
      buildClientFinancesTabPath({
        isLegacy,
        leadId: leadId || lead?.id,
        leadNumber: lead?.lead_number || leadNumber || null,
        manualId: lead?.manual_id != null ? String(lead.manual_id) : null,
      }) ||
      buildCalendarClientRoute({
        lead_type: isLegacy ? 'legacy' : 'new',
        lead_number: leadNumber || null,
        manual_id: lead?.manual_id ?? null,
        id: lead?.id ?? leadId,
      });
    rows.push({
      id: `fail-${tx.id}`,
      leadNumber,
      clientName,
      ...toAmountParts(amount, link?.currency, null),
      errorReason: failedPaymentReason({
        status: tx.status,
        errorMessage: tx.error_message,
        statusCode: link?.pelecard_status_code,
      }),
      href,
      failedAt: String(tx.created_at || tx.completed_at || ''),
    });
  }

  rows.sort((a, b) => String(b.failedAt).localeCompare(String(a.failedAt)));
  return rows;
}

function rowHasInvoiceSentFlag(row: {
  invoice_sent?: unknown;
  invoice_sent_at?: unknown;
  invoice_send_automation_sent_at?: unknown;
}): boolean {
  return Boolean(row.invoice_sent) || Boolean(row.invoice_sent_at) || Boolean(row.invoice_send_automation_sent_at);
}

function normalizeOrderCode(order: string | number | null | undefined): string {
  if (order == null) return '';
  const raw = String(order).trim();
  if (!raw) return '';
  if (!Number.isNaN(Number(raw))) return raw;
  switch (raw.toLowerCase()) {
    case 'first payment':
      return '1';
    case 'intermediate payment':
      return '5';
    case 'final payment':
      return '9';
    case 'single payment':
      return '90';
    case 'expense (no vat)':
      return '99';
    default:
      return raw;
  }
}

function orderLabelFromCode(order: string | number | null | undefined): string {
  switch (normalizeOrderCode(order)) {
    case '1':
      return 'First';
    case '5':
      return 'Intermediate';
    case '9':
      return 'Final';
    case '90':
      return 'Single';
    case '99':
      return 'Expense';
    default:
      return String(order || '').trim() || 'Payment';
  }
}

function dueMeta(dueDate: string, today: string): { dueLabel: string; daysAgo: number } {
  const due = dueDate.slice(0, 10);
  const start = new Date(`${due}T12:00:00`);
  const end = new Date(`${today}T12:00:00`);
  const daysAgo = Math.round((end.getTime() - start.getTime()) / 86400000);
  if (daysAgo <= 0) return { dueLabel: 'Due today', daysAgo: 0 };
  if (daysAgo === 1) return { dueLabel: 'Due yesterday', daysAgo: 1 };
  const pretty = start.toLocaleString('en-GB', { day: 'numeric', month: 'short' });
  return { dueLabel: `Due ${pretty} · ${daysAgo} days ago`, daysAgo };
}

async function fetchLegacyProformaMaps(legacyLeadIds: number[]): Promise<{
  byPpr: Set<number>;
  leadLevel: Set<string>;
}> {
  const byPpr = new Set<number>();
  const leadLevel = new Set<string>();
  for (let i = 0; i < legacyLeadIds.length; i += 400) {
    const batch = legacyLeadIds.slice(i, i + 400);
    if (!batch.length) continue;
    const { data } = await supabase
      .from('proformainvoice')
      .select('ppr_id, lead_id, client_id')
      .in('lead_id', batch)
      .is('cxd_date', null);
    for (const invoice of data || []) {
      const pprId = Number(invoice.ppr_id);
      if (invoice.ppr_id != null && Number.isFinite(pprId)) byPpr.add(pprId);
      else if (invoice.lead_id != null) {
        const leadId = String(invoice.lead_id);
        const clientId = invoice.client_id != null ? String(invoice.client_id) : 'any';
        leadLevel.add(`${leadId}_${clientId}`);
      }
    }
  }
  return { byPpr, leadLevel };
}

function legacyRowHasProforma(
  row: { id?: unknown; lead_id?: unknown; client_id?: unknown },
  byPpr: Set<number>,
  leadLevel: Set<string>,
): boolean {
  const pprId = Number(row.id);
  if (Number.isFinite(pprId) && byPpr.has(pprId)) return true;
  const leadId = String(row.lead_id ?? '').replace(/^legacy_?/i, '');
  if (!leadId) return false;
  const clientId = row.client_id != null && String(row.client_id).trim() ? String(row.client_id) : null;
  if (clientId && leadLevel.has(`${leadId}_${clientId}`)) return true;
  return leadLevel.has(`${leadId}_any`);
}

/** Unpaid sent-to-finance dues from the last 7 days that still need a proforma or a send. */
export async function fetchFinanceInvoiceInstructions(): Promise<FinanceInvoiceInstructionRow[]> {
  const range = last7DaysRange();
  const today = range.to;

  const [modernRows, legacyRows] = await Promise.all([
    fetchAllPaged<any>((from, to) =>
      supabase
        .from('payment_plans')
        .select(
          'id, lead_id, client_id, client_name, value, value_vat, currency, currency_id, due_date, paid, paid_at, proforma, ready_to_pay, cancel_date, payment_order, invoice_sent, invoice_sent_at, invoice_send_automation_sent_at',
        )
        .is('cancel_date', null)
        .eq('ready_to_pay', true)
        .not('due_date', 'is', null)
        .gte('due_date', range.from)
        .lte('due_date', range.to)
        .or('paid.is.null,paid.eq.false')
        .range(from, to),
    ).catch(() => []),
    fetchAllPaged<any>((from, to) =>
      supabase
        .from('finances_paymentplanrow')
        .select(
          'id, lead_id, client_id, value, value_base, vat_value, currency_id, due_date, actual_date, cancel_date, order, ready_to_pay, invoice_sent, invoice_sent_at, invoice_send_automation_sent_at',
        )
        .is('cancel_date', null)
        .eq('ready_to_pay', true)
        .not('due_date', 'is', null)
        .gte('due_date', range.from)
        .lte('due_date', range.to)
        .is('actual_date', null)
        .range(from, to),
    ).catch(() => []),
  ]);

  const modern = modernRows.filter((row) => !row.cancel_date && !isPaymentPaid(row) && row.lead_id);
  const unpaidLegacy = legacyRows.filter((row) => !isPaymentPaid(row) && row.lead_id != null);
  const legacyLeadIds = [
    ...new Set(
      unpaidLegacy
        .map((row) => Number(String(row.lead_id).replace(/^legacy_?/i, '')))
        .filter((id) => Number.isFinite(id)),
    ),
  ];
  const { byPpr, leadLevel } = await fetchLegacyProformaMaps(legacyLeadIds);

  type WorkingRow = {
    id: string;
    leadType: 'new' | 'legacy';
    leadId: string;
    clientId: string | number | null;
    clientNameHint: string;
    amountLabel: string;
    currencySign: string;
    amountNumber: string;
    dueDate: string;
    orderLabel: string;
    hasProforma: boolean;
    invoiceSent: boolean;
    collected: boolean;
    raw: any;
  };

  const working: WorkingRow[] = [];

  for (const row of modern) {
    working.push({
      id: `new-${row.id}`,
      leadType: 'new',
      leadId: String(row.lead_id),
      clientId: row.client_id ?? null,
      clientNameHint: String(row.client_name || '').trim(),
      ...toAmountParts(
        parseMoney(row.value) + parseMoney(row.value_vat),
        row.currency,
        row.currency_id,
      ),
      dueDate: String(row.due_date || '').slice(0, 10),
      orderLabel: orderLabelFromCode(row.payment_order),
      hasProforma: hasProformaValue(row.proforma),
      invoiceSent: rowHasInvoiceSentFlag(row),
      collected: false,
      raw: row,
    });
  }

  for (const row of unpaidLegacy) {
    const leadId = String(row.lead_id).replace(/^legacy_?/i, '');
    const amount = parseMoney(row.value) || parseMoney(row.value_base) + parseMoney(row.vat_value);
    working.push({
      id: `legacy-${row.id}`,
      leadType: 'legacy',
      leadId,
      clientId: row.client_id ?? null,
      clientNameHint: '',
      ...toAmountParts(amount, null, row.currency_id),
      dueDate: String(row.due_date || '').slice(0, 10),
      orderLabel: orderLabelFromCode(row.order),
      hasProforma: legacyRowHasProforma(row, byPpr, leadLevel),
      invoiceSent: rowHasInvoiceSentFlag(row),
      collected: false,
      raw: row,
    });
  }

  const marked = await applyInvoiceSentFromPaymentRequest(
    working.map((row) => ({
      leadId: row.leadType === 'legacy' ? `legacy_${row.leadId}` : row.leadId,
      leadType: row.leadType,
      clientId: row.clientId,
      hasProforma: row.hasProforma,
      invoiceSent: row.invoiceSent,
      collected: false,
    })),
  );

  const needed = working.filter((row, index) => {
    const next = marked[index];
    const hasProforma = next?.hasProforma ?? row.hasProforma;
    const invoiceSent = next?.invoiceSent ?? row.invoiceSent;
    row.hasProforma = hasProforma;
    row.invoiceSent = invoiceSent;
    return !hasProforma || !invoiceSent;
  });
  if (!needed.length) return [];

  const newLeadIds = [...new Set(needed.filter((row) => row.leadType === 'new').map((row) => row.leadId))];
  const legacyNeededIds = [
    ...new Set(
      needed
        .filter((row) => row.leadType === 'legacy')
        .map((row) => Number(row.leadId))
        .filter((id) => Number.isFinite(id)),
    ),
  ];
  const contactIds = [
    ...new Set(needed.map((row) => Number(row.clientId)).filter((id) => Number.isFinite(id))),
  ];

  const [newLeads, legacyLeads, contacts] = await Promise.all([
    newLeadIds.length
      ? fetchRowsInChunks(newLeadIds, async (chunk) => {
          const { data, error } = await supabase
            .from('leads')
            .select('id, name, lead_number, manual_id, anchor_full_name')
            .in('id', chunk);
          if (error) throw error;
          return data ?? [];
        })
      : Promise.resolve([]),
    legacyNeededIds.length
      ? fetchRowsInChunks(legacyNeededIds, async (chunk) => {
          const { data, error } = await supabase
            .from('leads_lead')
            .select('id, name, lead_number, manual_id, anchor_full_name')
            .in('id', chunk);
          if (error) throw error;
          return data ?? [];
        })
      : Promise.resolve([]),
    contactIds.length
      ? fetchRowsInChunks(contactIds, async (chunk) => {
          const { data, error } = await supabase.from('leads_contact').select('id, name').in('id', chunk);
          if (error) throw error;
          return data ?? [];
        }).catch(() => [])
      : Promise.resolve([]),
  ]);

  const newLeadById = new Map(newLeads.map((lead) => [String(lead.id), lead]));
  const legacyLeadById = new Map(legacyLeads.map((lead) => [String(lead.id), lead]));
  const contactById = new Map(contacts.map((contact) => [String(contact.id), contact]));

  const rows: FinanceInvoiceInstructionRow[] = needed.map((row) => {
    const lead = row.leadType === 'new' ? newLeadById.get(row.leadId) : legacyLeadById.get(row.leadId);
    const contact = contactById.get(String(row.clientId ?? ''));
    const leadNumber = String(lead?.lead_number || (row.leadType === 'legacy' ? row.leadId : '')).trim();
    const clientName =
      String(row.clientNameHint || contact?.name || lead?.name || lead?.anchor_full_name || '').trim() || '—';
    const { dueLabel, daysAgo } = dueMeta(row.dueDate, today);
    const href =
      buildClientFinancesTabPath({
        isLegacy: row.leadType === 'legacy',
        leadId: row.leadId,
        leadNumber: lead?.lead_number || leadNumber || null,
        manualId: lead?.manual_id != null ? String(lead.manual_id) : null,
      }) ||
      buildCalendarClientRoute({
        lead_type: row.leadType,
        lead_number: leadNumber || null,
        manual_id: lead?.manual_id ?? null,
        id: lead?.id ?? row.leadId,
      });
    return {
      id: row.id,
      kind: row.hasProforma ? 'send_invoice' : 'create_proforma',
      leadNumber,
      clientName,
      currencySign: row.currencySign,
      amountNumber: row.amountNumber,
      amountLabel: row.amountLabel,
      dueDate: row.dueDate,
      dueLabel,
      daysAgo,
      orderLabel: row.orderLabel,
      href,
    };
  });

  rows.sort((a, b) => {
    if (a.kind !== b.kind) return a.kind === 'create_proforma' ? -1 : 1;
    if (a.dueDate !== b.dueDate) return a.dueDate.localeCompare(b.dueDate);
    return a.clientName.localeCompare(b.clientName);
  });

  return rows;
}

export { formatNis };
