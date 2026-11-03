/**
 * Period metrics for the Handler Management tables: Received, Signed, Contribution and Applicants.
 *
 * Everything here is fetched once for the whole page and attributed to handlers afterwards, rather
 * than per handler. The page's older columns each cost a handful of queries per row, and three more
 * range-scoped numbers on that pattern would have multiplied the load; the stage, payment and
 * contact reads below are all firm-wide for the period and get split by lead id in memory.
 *
 * Contribution is the handler pool exactly as `salesContributionCalculator` computes it for someone
 * whose only role is handler — due in the period, normalised by the company due percentage, times
 * HANDLER%, times the Handlers department percentage. It deliberately stops before the Simple
 * Contribution report's department scaling step, which can only be done with every employee's row
 * in hand, so this figure can sit below the report's once that scaling applies.
 */
import { supabase } from './supabase';
import { convertToNIS } from './currencyConversion';
import { fetchAllPagedRows } from './invoicedInstallments';
import { fetchAverageGrossSalaryLastMonths } from './employeeSalaries';

export type HandlerPeriodRange = { from: string; to: string };

const isoDateKey = (date: Date) => date.toISOString().slice(0, 10);

/** The page's default window, matching the Due column's own last-30-days reading. */
export function lastThirtyDaysRange(ref: Date = new Date()): HandlerPeriodRange {
  const to = new Date(ref);
  const from = new Date(to);
  from.setDate(from.getDate() - 29);
  return { from: isoDateKey(from), to: isoDateKey(to) };
}

export function isDefaultHandlerPeriod(range: HandlerPeriodRange): boolean {
  const base = lastThirtyDaysRange();
  return range.from === base.from && range.to === base.to;
}

/** Lead ids a handler holds, with the signed value of each in NIS. */
export type HandlerLeadRefs = {
  newLeadIds: string[];
  legacyLeadIds: number[];
  signedNisByNewLeadId: Map<string, number>;
  signedNisByLegacyLeadId: Map<number, number>;
};

export function emptyHandlerLeadRefs(): HandlerLeadRefs {
  return {
    newLeadIds: [],
    legacyLeadIds: [],
    signedNisByNewLeadId: new Map(),
    signedNisByLegacyLeadId: new Map(),
  };
}

export type HandlerPeriodMetrics = {
  receivedCount: number;
  signedNis: number;
  dueInRangeNis: number;
  contributionNis: number;
  applicantsTotal: number;
};

export function emptyHandlerPeriodMetrics(): HandlerPeriodMetrics {
  return { receivedCount: 0, signedNis: 0, dueInRangeNis: 0, contributionNis: 0, applicantsTotal: 0 };
}

/** The three settings the handler pool is scaled by, all percentages out of 100. */
export type HandlerContributionRates = {
  dueNormalizedPct: number;
  handlerPct: number;
  departmentPct: number;
};

/** Same fallbacks the contribution reports use when a settings row is missing. */
const RATE_FALLBACKS: HandlerContributionRates = {
  dueNormalizedPct: 0,
  handlerPct: 0,
  departmentPct: 35,
};

export async function fetchHandlerContributionRates(): Promise<HandlerContributionRates> {
  const [incomeResult, roleResult, deptResult] = await Promise.all([
    supabase
      .from('sales_contribution_income')
      .select('due_normalized_percentage')
      .order('updated_at', { ascending: false })
      .limit(1)
      .maybeSingle(),
    supabase.from('role_percentages').select('role_name, percentage').eq('role_name', 'HANDLER').maybeSingle(),
    supabase
      .from('sales_contribution_settings')
      .select('department_name, percentage')
      .eq('department_name', 'Handlers')
      .maybeSingle(),
  ]);

  const readPct = (value: unknown, fallback: number) => {
    const parsed = Number(value);
    return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
  };

  return {
    dueNormalizedPct: readPct(
      incomeResult.data?.due_normalized_percentage,
      RATE_FALLBACKS.dueNormalizedPct,
    ),
    handlerPct: readPct(roleResult.data?.percentage, RATE_FALLBACKS.handlerPct),
    departmentPct: readPct(deptResult.data?.percentage, RATE_FALLBACKS.departmentPct),
  };
}

/** Due in the period, normalised, at HANDLER% of the Handlers department's share. */
export function handlerContributionNis(
  dueInRangeNis: number,
  rates: HandlerContributionRates,
): number {
  const due = Number(dueInRangeNis) || 0;
  if (!(due > 0)) return 0;
  const normalised = due * (rates.dueNormalizedPct / 100);
  return normalised * (rates.handlerPct / 100) * (rates.departmentPct / 100);
}

/**
 * What the employee costs over the same period, so the Contribution column can say whether the
 * handler covered themselves.
 *
 * Cost means gross salary, which is what the Simple Contribution report's Total Cost column shows.
 * Salary is held per calendar month, so the months the period touches are averaged (months with no
 * salary on file are skipped, not counted as zero) and then prorated to the period's length.
 */
const DAYS_PER_AVERAGE_MONTH = 30.44;

/** How many calendar months a period touches, which is how many salary months to average. */
export function calendarMonthsSpanned(range: HandlerPeriodRange): number {
  const from = new Date(`${range.from}T00:00:00Z`);
  const to = new Date(`${range.to}T00:00:00Z`);
  if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) return 1;
  const months =
    (to.getUTCFullYear() - from.getUTCFullYear()) * 12 + (to.getUTCMonth() - from.getUTCMonth()) + 1;
  return Math.max(1, months);
}

export async function fetchHandlerMonthlyCosts(
  employeeIds: number[],
  range: HandlerPeriodRange,
): Promise<Map<number, number>> {
  const ids = employeeIds.filter((id) => Number.isFinite(id));
  if (ids.length === 0) return new Map();
  const ref = new Date(`${range.to}T00:00:00Z`);
  return fetchAverageGrossSalaryLastMonths(
    ids,
    calendarMonthsSpanned(range),
    Number.isNaN(ref.getTime()) ? new Date() : ref,
  );
}

/** A monthly cost prorated to the period, so a fortnight is compared against half a month's cost. */
export function handlerPeriodCostNis(monthlyCostNis: number, range: HandlerPeriodRange): number {
  const monthly = Number(monthlyCostNis) || 0;
  if (!(monthly > 0)) return 0;
  const from = new Date(`${range.from}T00:00:00Z`);
  const to = new Date(`${range.to}T00:00:00Z`);
  if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) return monthly;
  const days = Math.max(1, Math.round((to.getTime() - from.getTime()) / 86_400_000) + 1);
  return monthly * (days / DAYS_PER_AVERAGE_MONTH);
}

/**
 * How a period figure reads at a glance. `unknown` means there is nothing to judge it against.
 */
export type HandlerMetricTone = 'good' | 'watch' | 'bad' | 'unknown';

/** Six cases a period is the target; four or five is short of it; below that is a problem. */
export const RECEIVED_TARGET = 6;
export const RECEIVED_WATCH_FLOOR = 4;

export function receivedCountTone(count: number): HandlerMetricTone {
  const received = Number(count) || 0;
  if (received >= RECEIVED_TARGET) return 'good';
  if (received >= RECEIVED_WATCH_FLOOR) return 'watch';
  return 'bad';
}

/** A handler is expected to bring in their own cost with this much on top of it. */
export const CONTRIBUTION_TARGET_MARKUP = 0.4;

/** Within a tenth of the target reads as close to it rather than short of it. */
export const CONTRIBUTION_CLOSE_TO_TARGET_RATIO = 0.9;

/** The contribution a handler's salary asks for: their cost for the period plus 40%. */
export function handlerContributionTargetNis(periodCostNis: number): number {
  const cost = Number(periodCostNis) || 0;
  return cost > 0 ? cost * (1 + CONTRIBUTION_TARGET_MARKUP) : 0;
}

/** Salary up to this share of the contribution it brought in is on target. */
export const COST_SHARE_TARGET_PCT = 40;

/** Past the target but no further than this is a warning rather than a problem. */
export const COST_SHARE_WATCH_CEILING_PCT = 50;

/** How the salary-to-contribution share reads: at 40% or under, up to 50%, or above it. */
export function costSharePctTone(pct: number): HandlerMetricTone {
  const share = Number(pct) || 0;
  if (share <= COST_SHARE_TARGET_PCT) return 'good';
  if (share <= COST_SHARE_WATCH_CEILING_PCT) return 'watch';
  return 'bad';
}

/** Whether the contribution clears that target, is nearly there, or falls short. */
export function contributionTone(contributionNis: number, periodCostNis: number): HandlerMetricTone {
  const target = handlerContributionTargetNis(periodCostNis);
  if (!(target > 0)) return 'unknown';
  const contribution = Number(contributionNis) || 0;
  if (contribution >= target) return 'good';
  if (contribution >= target * CONTRIBUTION_CLOSE_TO_TARGET_RATIO) return 'watch';
  return 'bad';
}

type StageRecord = {
  lead_id?: number | string | null;
  newlead_id?: string | null;
  date?: string | null;
  cdate?: string | null;
};

/**
 * Every lead that reached `stage` inside the period.
 *
 * `date` is the stage's own timestamp and `cdate` the row's creation, which is all some older rows
 * have — hence the second query. Both are read firm-wide and matched to handlers by lead id.
 */
export async function fetchLeadsReachingStageInRange(
  stage: number,
  range: HandlerPeriodRange,
): Promise<{ newLeadIds: Set<string>; legacyLeadIds: Set<number> }> {
  const fromIso = `${range.from}T00:00:00.000Z`;
  const toIso = `${range.to}T23:59:59.999Z`;

  const [dated, undated] = await Promise.all([
    fetchAllPagedRows<StageRecord>((from, to) =>
      supabase
        .from('leads_leadstage')
        .select('lead_id, newlead_id, date, cdate')
        .eq('stage', stage)
        .gte('date', fromIso)
        .lte('date', toIso)
        .order('id', { ascending: true })
        .range(from, to),
    ),
    fetchAllPagedRows<StageRecord>((from, to) =>
      supabase
        .from('leads_leadstage')
        .select('lead_id, newlead_id, date, cdate')
        .eq('stage', stage)
        .is('date', null)
        .gte('cdate', fromIso)
        .lte('cdate', toIso)
        .order('id', { ascending: true })
        .range(from, to),
    ),
  ]);

  const newLeadIds = new Set<string>();
  const legacyLeadIds = new Set<number>();
  for (const row of [...dated, ...undated]) {
    if (row.newlead_id) newLeadIds.add(String(row.newlead_id));
    const legacyId = row.lead_id != null ? Number(row.lead_id) : NaN;
    if (Number.isFinite(legacyId) && legacyId > 0) legacyLeadIds.add(legacyId);
  }
  return { newLeadIds, legacyLeadIds };
}

/** A currency symbol or name as `convertToNIS` wants it. */
function normaliseCurrency(raw: unknown): string {
  const value = String(raw ?? '').trim();
  if (!value) return 'NIS';
  if (value === '₪') return 'NIS';
  if (value === '€') return 'EUR';
  if (value === '$') return 'USD';
  if (value === '£') return 'GBP';
  return value;
}

const LEGACY_CURRENCY_BY_ID: Record<number, string> = { 1: 'NIS', 2: 'EUR', 3: 'USD', 4: 'GBP' };

/**
 * Due money in the period, per lead, in NIS.
 *
 * The same reading as the page's existing Due column — a payment row counts when it is marked ready
 * to pay, is not cancelled, and falls due inside the window — only fetched once for every lead
 * instead of once per handler.
 */
export async function fetchDueInRangeByLead(range: HandlerPeriodRange): Promise<{
  byNewLeadId: Map<string, number>;
  byLegacyLeadId: Map<number, number>;
}> {
  const fromDateTime = `${range.from}T00:00:00`;
  const toDateTime = `${range.to}T23:59:59`;

  const [newResult, legacyRows] = await Promise.all([
    supabase
      .from('payment_plans')
      .select('lead_id, value, currency, due_date, ready_to_pay, cancel_date')
      .eq('ready_to_pay', true)
      .not('due_date', 'is', null)
      .is('cancel_date', null)
      .gte('due_date', fromDateTime)
      .lte('due_date', toDateTime),
    fetchAllPagedRows<any>((from, to) =>
      supabase
        .from('finances_paymentplanrow')
        .select(
          `id, lead_id, value, value_base, currency_id, due_date, cancel_date,
           accounting_currencies!finances_paymentplanrow_currency_id_fkey(name, iso_code)`,
        )
        .not('due_date', 'is', null)
        .is('cancel_date', null)
        .gte('due_date', fromDateTime)
        .lte('due_date', toDateTime)
        .order('id', { ascending: true })
        .range(from, to),
    ),
  ]);

  const byNewLeadId = new Map<string, number>();
  for (const row of newResult.data || []) {
    if (!row.lead_id) continue;
    const key = String(row.lead_id);
    const amount = convertToNIS(Number(row.value || 0), normaliseCurrency(row.currency));
    byNewLeadId.set(key, (byNewLeadId.get(key) || 0) + amount);
  }

  const byLegacyLeadId = new Map<number, number>();
  for (const row of legacyRows) {
    const leadId = Number(row.lead_id);
    if (!Number.isFinite(leadId)) continue;
    const accounting = Array.isArray(row.accounting_currencies)
      ? row.accounting_currencies[0]
      : row.accounting_currencies;
    const currency =
      accounting?.name ||
      accounting?.iso_code ||
      LEGACY_CURRENCY_BY_ID[Number(row.currency_id)] ||
      'NIS';
    const amount = convertToNIS(Number(row.value || row.value_base || 0), normaliseCurrency(currency));
    byLegacyLeadId.set(leadId, (byLegacyLeadId.get(leadId) || 0) + amount);
  }

  return { byNewLeadId, byLegacyLeadId };
}

/** How many ids one `.in(...)` filter carries. */
const ID_CHUNK = 200;

function chunked<T>(items: T[], size = ID_CHUNK): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < items.length; i += size) chunks.push(items.slice(i, i + size));
  return chunks;
}

/**
 * Applicants per lead, counted the way the unassigned-leads table counts them: `contacts` rows for
 * a new lead, `lead_leadcontact` rows for a legacy one.
 */
export async function fetchApplicantsByLead(
  newLeadIds: string[],
  legacyLeadIds: number[],
): Promise<{ byNewLeadId: Map<string, number>; byLegacyLeadId: Map<number, number> }> {
  const byNewLeadId = new Map<string, number>();
  const byLegacyLeadId = new Map<number, number>();

  await Promise.all([
    ...chunked(newLeadIds).map(async (chunk) => {
      const { data, error } = await supabase.from('contacts').select('lead_id').in('lead_id', chunk);
      if (error) {
        console.error('[handlerPeriodMetrics] new lead contacts fetch failed:', error);
        return;
      }
      for (const row of data || []) {
        if (!row.lead_id) continue;
        const key = String(row.lead_id);
        byNewLeadId.set(key, (byNewLeadId.get(key) || 0) + 1);
      }
    }),
    ...chunked(legacyLeadIds).map(async (chunk) => {
      const { data, error } = await supabase
        .from('lead_leadcontact')
        .select('lead_id')
        .in('lead_id', chunk);
      if (error) {
        console.error('[handlerPeriodMetrics] legacy lead contacts fetch failed:', error);
        return;
      }
      for (const row of data || []) {
        const leadId = Number(row.lead_id);
        if (!Number.isFinite(leadId)) continue;
        byLegacyLeadId.set(leadId, (byLegacyLeadId.get(leadId) || 0) + 1);
      }
    }),
  ]);

  return { byNewLeadId, byLegacyLeadId };
}

export type HandlerPeriodInputs = {
  received: { newLeadIds: Set<string>; legacyLeadIds: Set<number> };
  signed: { newLeadIds: Set<string>; legacyLeadIds: Set<number> };
  due: { byNewLeadId: Map<string, number>; byLegacyLeadId: Map<number, number> };
  applicants: { byNewLeadId: Map<string, number>; byLegacyLeadId: Map<number, number> };
  rates: HandlerContributionRates;
};

/**
 * One handler's period numbers, from their lead ids and the firm-wide reads above.
 *
 * Received and Signed both ask whether a lead the handler holds *now* crossed the stage inside the
 * period. A case reassigned mid-period therefore counts for whoever holds it today, which is the
 * only attribution the lead tables can answer: they keep the current handler, not a history of them.
 */
export function handlerPeriodMetrics(
  refs: HandlerLeadRefs,
  inputs: HandlerPeriodInputs,
): HandlerPeriodMetrics {
  let receivedCount = 0;
  let signedNis = 0;
  let dueInRangeNis = 0;
  let applicantsTotal = 0;

  for (const id of refs.newLeadIds) {
    if (inputs.received.newLeadIds.has(id)) receivedCount += 1;
    if (inputs.signed.newLeadIds.has(id)) signedNis += refs.signedNisByNewLeadId.get(id) || 0;
    dueInRangeNis += inputs.due.byNewLeadId.get(id) || 0;
    applicantsTotal += inputs.applicants.byNewLeadId.get(id) || 0;
  }

  for (const id of refs.legacyLeadIds) {
    if (inputs.received.legacyLeadIds.has(id)) receivedCount += 1;
    if (inputs.signed.legacyLeadIds.has(id)) signedNis += refs.signedNisByLegacyLeadId.get(id) || 0;
    dueInRangeNis += inputs.due.byLegacyLeadId.get(id) || 0;
    applicantsTotal += inputs.applicants.byLegacyLeadId.get(id) || 0;
  }

  return {
    receivedCount,
    signedNis,
    dueInRangeNis,
    contributionNis: handlerContributionNis(dueInRangeNis, inputs.rates),
    applicantsTotal,
  };
}
