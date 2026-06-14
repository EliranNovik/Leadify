import { supabase } from './supabase';
import { managementAmountToNis } from './firmManagementCosts';
import {
  EXPENSE_TYPE_CODE_MARKETING,
  EXPENSE_TYPE_CODE_OFFICE,
  EXPENSE_TYPE_CODE_RENT,
  isRoutedFirmManagementExpenseTypeCode,
} from './expenseTypes';

export const EXPENSE_CATEGORY_LABELS = {
  source_media: 'Source media',
  firm_management: 'Firm management costs',
  rent: 'Rent',
  partner_draws: 'Partner draws',
  salaries: 'Salaries',
  office: 'Office expenses',
} as const;

export type ExpenseCategoryKey = keyof typeof EXPENSE_CATEGORY_LABELS;

export const EXPENSE_CATEGORY_ORDER: ExpenseCategoryKey[] = [
  'source_media',
  'firm_management',
  'rent',
  'partner_draws',
  'salaries',
  'office',
];

export type ExpenseCategoryTotals = Record<ExpenseCategoryKey, number> & {
  /** Firm management costs with Marketing Expense type (rolled into marketing summary). */
  firm_management_marketing: number;
};

export type MonthlyExpenseBreakdown = {
  monthKey: string;
  label: string;
  totals: ExpenseCategoryTotals;
  totalNis: number;
};

/** Calendar months (YYYY-MM-01) overlapping the report date range. */
export function listExpenseMonthsInRange(fromDate: string, toDate: string): string[] {
  const from = (fromDate || toDate || '').trim();
  const to = (toDate || fromDate || '').trim();
  if (!from && !to) return [];

  const parseYm = (s: string) => {
    const [y, m] = s.split('-').map(Number);
    return { y: y || 2000, m: m || 1 };
  };

  let { y: y1, m: m1 } = parseYm(from || to);
  let { y: y2, m: m2 } = parseYm(to || from);
  if (y1 > y2 || (y1 === y2 && m1 > m2)) {
    [y1, m1, y2, m2] = [y2, m2, y1, m1];
  }

  const out: string[] = [];
  let y = y1;
  let m = m1;
  for (;;) {
    out.push(`${y}-${String(m).padStart(2, '0')}-01`);
    if (y === y2 && m === m2) break;
    m += 1;
    if (m > 12) {
      m = 1;
      y += 1;
    }
  }
  return out;
}

export function monthKeysForYearMonth(year: string, month: string): string[] {
  if (!year) return [];
  if (month) {
    return [`${year}-${month}-01`];
  }
  return Array.from({ length: 12 }, (_, i) => `${year}-${String(i + 1).padStart(2, '0')}-01`);
}

export function formatMonthKeyLabel(monthKey: string): string {
  const d = new Date(`${monthKey}T12:00:00`);
  if (Number.isNaN(d.getTime())) return monthKey;
  return d.toLocaleDateString('en-US', { month: 'short', year: 'numeric' });
}

export function emptyCategoryTotals(): ExpenseCategoryTotals {
  return {
    source_media: 0,
    firm_management: 0,
    rent: 0,
    partner_draws: 0,
    salaries: 0,
    office: 0,
    firm_management_marketing: 0,
  };
}

function salaryMonthKey(salaryYear: number, salaryMonth: number): string {
  return `${salaryYear}-${String(salaryMonth).padStart(2, '0')}-01`;
}

async function fetchSourceMediaByMonth(monthKeys: string[]): Promise<Map<string, number>> {
  const byMonth = new Map<string, number>();
  if (monthKeys.length === 0) return byMonth;

  const { data, error } = await supabase
    .from('source_media_expense')
    .select('expense_month, amount')
    .in('expense_month', monthKeys);

  if (error) throw error;

  for (const row of data || []) {
    const key = String(row.expense_month).slice(0, 10);
    const prev = byMonth.get(key) || 0;
    byMonth.set(key, prev + (Number(row.amount) || 0));
  }
  return byMonth;
}

async function fetchFirmManagementSplitByMonth(monthKeys: string[]): Promise<{
  firmManagement: Map<string, number>;
  marketing: Map<string, number>;
  rent: Map<string, number>;
  office: Map<string, number>;
}> {
  const firmManagement = new Map<string, number>();
  const marketing = new Map<string, number>();
  const rent = new Map<string, number>();
  const office = new Map<string, number>();
  if (monthKeys.length === 0) {
    return { firmManagement, marketing, rent, office };
  }

  const { data, error } = await supabase
    .from('firm_management_costs')
    .select('billing_month, amount, currency, expense_types ( code )')
    .in('billing_month', monthKeys);

  if (error) throw error;

  for (const row of data || []) {
    const key = String(row.billing_month).slice(0, 10);
    const nis = managementAmountToNis(row.amount, row.currency);
    const typeRaw = row.expense_types as { code?: string | null } | { code?: string | null }[] | null;
    const code = (Array.isArray(typeRaw) ? typeRaw[0]?.code : typeRaw?.code) ?? null;

    if (code === EXPENSE_TYPE_CODE_RENT) {
      rent.set(key, (rent.get(key) || 0) + nis);
    } else if (code === EXPENSE_TYPE_CODE_MARKETING) {
      marketing.set(key, (marketing.get(key) || 0) + nis);
    } else if (code === EXPENSE_TYPE_CODE_OFFICE) {
      office.set(key, (office.get(key) || 0) + nis);
    } else {
      firmManagement.set(key, (firmManagement.get(key) || 0) + nis);
    }
  }

  return { firmManagement, marketing, rent, office };
}

async function fetchRentByMonth(monthKeys: string[]): Promise<Map<string, number>> {
  const byMonth = new Map<string, number>();
  if (monthKeys.length === 0) return byMonth;

  const { data, error } = await supabase
    .from('office_rent_expense')
    .select('expense_month, amount_nis')
    .in('expense_month', monthKeys);

  if (error) throw error;

  for (const row of data || []) {
    const key = String(row.expense_month).slice(0, 10);
    const prev = byMonth.get(key) || 0;
    byMonth.set(key, prev + (Number(row.amount_nis) || 0));
  }
  return byMonth;
}

async function fetchPartnerDrawsByMonth(monthKeys: string[]): Promise<Map<string, number>> {
  const byMonth = new Map<string, number>();
  if (monthKeys.length === 0) return byMonth;

  const { data, error } = await supabase
    .from('partner_draw_expense')
    .select('expense_month, amount_nis')
    .in('expense_month', monthKeys);

  if (error) throw error;

  for (const row of data || []) {
    const key = String(row.expense_month).slice(0, 10);
    const prev = byMonth.get(key) || 0;
    byMonth.set(key, prev + (Number(row.amount_nis) || 0));
  }
  return byMonth;
}

async function fetchOfficeExpensesByMonth(monthKeys: string[]): Promise<Map<string, number>> {
  const byMonth = new Map<string, number>();
  if (monthKeys.length === 0) return byMonth;

  const monthKeySet = new Set(monthKeys);
  const years = [...new Set(monthKeys.map(k => Number(k.slice(0, 4))))].filter(Number.isFinite);
  if (years.length === 0) return byMonth;

  const minYear = Math.min(...years);
  const maxYear = Math.max(...years);

  const { data, error } = await supabase
    .from('office_expenses')
    .select('created_at, amount, currency')
    .gte('created_at', `${minYear}-01-01`)
    .lt('created_at', `${maxYear + 1}-01-01`);

  if (error) throw error;

  for (const row of data || []) {
    const created = String(row.created_at || '').slice(0, 10);
    if (created.length < 7) continue;
    const monthKey = `${created.slice(0, 7)}-01`;
    if (!monthKeySet.has(monthKey)) continue;
    const prev = byMonth.get(monthKey) || 0;
    byMonth.set(monthKey, prev + managementAmountToNis(row.amount, row.currency));
  }
  return byMonth;
}

async function fetchSalariesByMonth(monthKeys: string[]): Promise<Map<string, number>> {
  const byMonth = new Map<string, number>();
  if (monthKeys.length === 0) return byMonth;

  const monthKeySet = new Set(monthKeys);
  const years = [...new Set(monthKeys.map(k => Number(k.slice(0, 4))))].filter(Number.isFinite);
  if (years.length === 0) return byMonth;

  const minYear = Math.min(...years);
  const maxYear = Math.max(...years);

  const { data, error } = await supabase
    .from('employee_salary')
    .select('gross_salary, salary_month, salary_year')
    .gte('salary_year', minYear)
    .lte('salary_year', maxYear);

  if (error) throw error;

  for (const row of data || []) {
    const key = salaryMonthKey(Number(row.salary_year), Number(row.salary_month));
    if (!monthKeySet.has(key)) continue;
    const prev = byMonth.get(key) || 0;
    byMonth.set(key, prev + (Number(row.gross_salary) || 0));
  }
  return byMonth;
}

export function mergeMonthlyBreakdown(
  monthKeys: string[],
  maps: {
    sourceMedia: Map<string, number>;
    firmManagement: Map<string, number>;
    rent: Map<string, number>;
    partnerDraws: Map<string, number>;
    salaries: Map<string, number>;
    office: Map<string, number>;
    firmManagementMarketing: Map<string, number>;
    firmManagementRent: Map<string, number>;
    firmManagementOffice: Map<string, number>;
  },
): MonthlyExpenseBreakdown[] {
  return monthKeys.map(monthKey => {
    const totals: ExpenseCategoryTotals = {
      source_media: maps.sourceMedia.get(monthKey) || 0,
      firm_management: maps.firmManagement.get(monthKey) || 0,
      rent: (maps.rent.get(monthKey) || 0) + (maps.firmManagementRent.get(monthKey) || 0),
      partner_draws: maps.partnerDraws.get(monthKey) || 0,
      salaries: maps.salaries.get(monthKey) || 0,
      office: (maps.office.get(monthKey) || 0) + (maps.firmManagementOffice.get(monthKey) || 0),
      firm_management_marketing: maps.firmManagementMarketing.get(monthKey) || 0,
    };
    const totalNis =
      EXPENSE_CATEGORY_ORDER.reduce((sum, key) => sum + totals[key], 0) +
      totals.firm_management_marketing;
    return {
      monthKey,
      label: formatMonthKeyLabel(monthKey),
      totals,
      totalNis,
    };
  });
}

export function sumCategoryTotals(rows: MonthlyExpenseBreakdown[]): ExpenseCategoryTotals {
  const out = emptyCategoryTotals();
  for (const row of rows) {
    for (const key of EXPENSE_CATEGORY_ORDER) {
      out[key] += row.totals[key];
    }
    out.firm_management_marketing += row.totals.firm_management_marketing;
  }
  return out;
}

export function marketingExpenseTotal(totals: ExpenseCategoryTotals): number {
  return totals.source_media + totals.firm_management_marketing;
}

export async function fetchAllExpensesBreakdown(monthKeys: string[]): Promise<MonthlyExpenseBreakdown[]> {
  const [
    sourceMedia,
    firmManagementSplit,
    rent,
    partnerDraws,
    salaries,
    office,
  ] = await Promise.all([
    fetchSourceMediaByMonth(monthKeys),
    fetchFirmManagementSplitByMonth(monthKeys),
    fetchRentByMonth(monthKeys),
    fetchPartnerDrawsByMonth(monthKeys),
    fetchSalariesByMonth(monthKeys),
    fetchOfficeExpensesByMonth(monthKeys),
  ]);

  return mergeMonthlyBreakdown(monthKeys, {
    sourceMedia,
    firmManagement: firmManagementSplit.firmManagement,
    rent,
    partnerDraws,
    salaries,
    office,
    firmManagementMarketing: firmManagementSplit.marketing,
    firmManagementRent: firmManagementSplit.rent,
    firmManagementOffice: firmManagementSplit.office,
  });
}

export const formatNis = (value: number): string =>
  new Intl.NumberFormat('he-IL', {
    style: 'currency',
    currency: 'ILS',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(value);

export type FirmManagementCostByFirmRow = {
  firmId: string;
  firmName: string;
  monthKey: string;
  amountNis: number;
};

export async function fetchFirmManagementCostsByFirm(
  monthKeys: string[],
): Promise<FirmManagementCostByFirmRow[]> {
  if (monthKeys.length === 0) return [];

  const { data, error } = await supabase
    .from('firm_management_costs')
    .select('firm_id, billing_month, amount, currency, expense_types ( code ), firms ( name )')
    .in('billing_month', monthKeys);

  if (error) throw error;

  const aggregated = new Map<string, FirmManagementCostByFirmRow>();
  for (const row of data || []) {
    const typeRaw = row.expense_types as { code?: string | null } | { code?: string | null }[] | null;
    const code = (Array.isArray(typeRaw) ? typeRaw[0]?.code : typeRaw?.code) ?? null;
    if (isRoutedFirmManagementExpenseTypeCode(code)) continue;

    const firmId = String(row.firm_id);
    const monthKey = String(row.billing_month).slice(0, 10);
    const firmRaw = row.firms as { name: string | null } | { name: string | null }[] | null;
    const firmName =
      (Array.isArray(firmRaw) ? firmRaw[0]?.name : firmRaw?.name)?.trim() || `Firm ${firmId.slice(0, 8)}`;
    const mapKey = `${firmId}|${monthKey}`;
    const nis = managementAmountToNis(row.amount, row.currency);
    const existing = aggregated.get(mapKey);
    if (existing) {
      existing.amountNis += nis;
    } else {
      aggregated.set(mapKey, { firmId, firmName, monthKey, amountNis: nis });
    }
  }

  return [...aggregated.values()];
}

export async function fetchOfficeExpensesByFirm(
  monthKeys: string[],
): Promise<FirmManagementCostByFirmRow[]> {
  if (monthKeys.length === 0) return [];

  const monthKeySet = new Set(monthKeys);
  const years = [...new Set(monthKeys.map(k => Number(k.slice(0, 4))))].filter(Number.isFinite);
  if (years.length === 0) return [];

  const minYear = Math.min(...years);
  const maxYear = Math.max(...years);

  const [officeTableResult, firmManagementResult] = await Promise.all([
    supabase
      .from('office_expenses')
      .select('firm_id, created_at, amount, currency, firms ( name )')
      .gte('created_at', `${minYear}-01-01`)
      .lt('created_at', `${maxYear + 1}-01-01`),
    supabase
      .from('firm_management_costs')
      .select('firm_id, billing_month, amount, currency, expense_types ( code ), firms ( name )')
      .in('billing_month', monthKeys),
  ]);

  if (officeTableResult.error) throw officeTableResult.error;
  if (firmManagementResult.error) throw firmManagementResult.error;

  const aggregated = new Map<string, FirmManagementCostByFirmRow>();

  const addRow = (
    firmId: string,
    firmName: string,
    monthKey: string,
    amountNis: number,
  ) => {
    const mapKey = `${firmId}|${monthKey}`;
    const existing = aggregated.get(mapKey);
    if (existing) {
      existing.amountNis += amountNis;
    } else {
      aggregated.set(mapKey, { firmId, firmName, monthKey, amountNis });
    }
  };

  for (const row of officeTableResult.data || []) {
    const created = String(row.created_at || '').slice(0, 10);
    if (created.length < 7) continue;
    const monthKey = `${created.slice(0, 7)}-01`;
    if (!monthKeySet.has(monthKey)) continue;

    const firmId = String(row.firm_id);
    const firmRaw = row.firms as { name: string | null } | { name: string | null }[] | null;
    const firmName =
      (Array.isArray(firmRaw) ? firmRaw[0]?.name : firmRaw?.name)?.trim() || `Firm ${firmId.slice(0, 8)}`;
    addRow(firmId, firmName, monthKey, managementAmountToNis(row.amount, row.currency));
  }

  for (const row of firmManagementResult.data || []) {
    const typeRaw = row.expense_types as { code?: string | null } | { code?: string | null }[] | null;
    const code = (Array.isArray(typeRaw) ? typeRaw[0]?.code : typeRaw?.code) ?? null;
    if (code !== EXPENSE_TYPE_CODE_OFFICE) continue;

    const firmId = String(row.firm_id);
    const monthKey = String(row.billing_month).slice(0, 10);
    const firmRaw = row.firms as { name: string | null } | { name: string | null }[] | null;
    const firmName =
      (Array.isArray(firmRaw) ? firmRaw[0]?.name : firmRaw?.name)?.trim() || `Firm ${firmId.slice(0, 8)}`;
    addRow(firmId, firmName, monthKey, managementAmountToNis(row.amount, row.currency));
  }

  return [...aggregated.values()];
}

export type EntityBreakdownBarPoint = {
  name: string;
  amount: number;
  fill: string;
};

export type EntityBreakdownStackedMonthPoint = Record<string, string | number>;

/** @deprecated Use EntityBreakdownBarPoint */
export type FirmManagementFirmBarPoint = EntityBreakdownBarPoint;

/** @deprecated Use EntityBreakdownStackedMonthPoint */
export type FirmManagementStackedMonthPoint = EntityBreakdownStackedMonthPoint;

const ENTITY_CHART_PALETTE = [
  '#8b5cf6',
  '#6366f1',
  '#0ea5e9',
  '#14b8a6',
  '#f59e0b',
  '#ec4899',
  '#10b981',
  '#f97316',
  '#64748b',
];

const OTHER_ENTITY_COLOR = '#94a3b8';

type EntityMonthRow = {
  entityId: string;
  entityName: string;
  monthKey: string;
  amountNis: number;
};

function buildSingleMonthEntityChart(
  rows: EntityMonthRow[],
  monthKey: string,
): EntityBreakdownBarPoint[] {
  const byEntity = new Map<string, { name: string; amount: number }>();
  for (const row of rows) {
    if (row.monthKey !== monthKey) continue;
    const prev = byEntity.get(row.entityId);
    if (prev) {
      prev.amount += row.amountNis;
    } else {
      byEntity.set(row.entityId, { name: row.entityName, amount: row.amountNis });
    }
  }

  return [...byEntity.values()]
    .filter(p => p.amount > 0)
    .sort((a, b) => b.amount - a.amount)
    .map((p, i) => ({
      name: p.name,
      amount: p.amount,
      fill: ENTITY_CHART_PALETTE[i % ENTITY_CHART_PALETTE.length],
    }));
}

function buildYearStackedEntityChart(
  rows: EntityMonthRow[],
  monthKeys: string[],
  topEntityCount = 8,
): { chartData: EntityBreakdownStackedMonthPoint[]; series: { key: string; fill: string }[] } {
  const entityTotals = new Map<string, { name: string; total: number }>();
  for (const row of rows) {
    const prev = entityTotals.get(row.entityId);
    if (prev) {
      prev.total += row.amountNis;
    } else {
      entityTotals.set(row.entityId, { name: row.entityName, total: row.amountNis });
    }
  }

  const topEntities = [...entityTotals.entries()]
    .filter(([, v]) => v.total > 0)
    .sort((a, b) => b[1].total - a[1].total)
    .slice(0, topEntityCount);

  const topEntityIds = new Set(topEntities.map(([id]) => id));
  const idToName = new Map(topEntities.map(([id, v]) => [id, v.name]));

  const chartData: EntityBreakdownStackedMonthPoint[] = monthKeys.map(monthKey => {
    const point: EntityBreakdownStackedMonthPoint = {
      name: formatMonthKeyLabel(monthKey),
    };
    let other = 0;
    for (const row of rows) {
      if (row.monthKey !== monthKey || row.amountNis <= 0) continue;
      if (topEntityIds.has(row.entityId)) {
        const label = idToName.get(row.entityId) || row.entityName;
        point[label] = (Number(point[label]) || 0) + row.amountNis;
      } else {
        other += row.amountNis;
      }
    }
    if (other > 0) {
      point.Other = other;
    }
    return point;
  });

  const series = topEntities.map(([, v], i) => ({
    key: v.name,
    fill: ENTITY_CHART_PALETTE[i % ENTITY_CHART_PALETTE.length],
  }));

  const hasOther = chartData.some(p => Number(p.Other) > 0);
  if (hasOther) {
    series.push({ key: 'Other', fill: OTHER_ENTITY_COLOR });
  }

  return { chartData, series };
}

const firmToEntityRows = (rows: FirmManagementCostByFirmRow[]): EntityMonthRow[] =>
  rows.map(r => ({
    entityId: r.firmId,
    entityName: r.firmName,
    monthKey: r.monthKey,
    amountNis: r.amountNis,
  }));

/** Bar chart: one bar per firm for a single selected month. */
export function buildFirmManagementSingleMonthChart(
  rows: FirmManagementCostByFirmRow[],
  monthKey: string,
): EntityBreakdownBarPoint[] {
  return buildSingleMonthEntityChart(firmToEntityRows(rows), monthKey);
}

/** Stacked bars by month; top firms by year total, remainder as "Other". */
export function buildFirmManagementYearStackedChart(
  rows: FirmManagementCostByFirmRow[],
  monthKeys: string[],
  topFirmCount = 8,
): { chartData: EntityBreakdownStackedMonthPoint[]; firmSeries: { key: string; fill: string }[] } {
  const { chartData, series } = buildYearStackedEntityChart(firmToEntityRows(rows), monthKeys, topFirmCount);
  return { chartData, firmSeries: series };
}

export type SourceMediaCostBySourceRow = {
  sourceId: string;
  sourceName: string;
  monthKey: string;
  amountNis: number;
};

export async function fetchSourceMediaCostsBySource(
  monthKeys: string[],
): Promise<SourceMediaCostBySourceRow[]> {
  if (monthKeys.length === 0) return [];

  const { data, error } = await supabase
    .from('source_media_expense')
    .select('lead_source_id, expense_month, amount, misc_leadsource ( name )')
    .in('expense_month', monthKeys);

  if (error) throw error;

  const aggregated = new Map<string, SourceMediaCostBySourceRow>();
  for (const row of data || []) {
    const sourceId = String(row.lead_source_id);
    const monthKey = String(row.expense_month).slice(0, 10);
    const sourceRaw = row.misc_leadsource as { name: string | null } | { name: string | null }[] | null;
    const sourceName =
      (Array.isArray(sourceRaw) ? sourceRaw[0]?.name : sourceRaw?.name)?.trim() ||
      `Source #${sourceId}`;
    const mapKey = `${sourceId}|${monthKey}`;
    const nis = Number(row.amount) || 0;
    const existing = aggregated.get(mapKey);
    if (existing) {
      existing.amountNis += nis;
    } else {
      aggregated.set(mapKey, { sourceId, sourceName, monthKey, amountNis: nis });
    }
  }

  return [...aggregated.values()];
}

const sourceToEntityRows = (rows: SourceMediaCostBySourceRow[]): EntityMonthRow[] =>
  rows.map(r => ({
    entityId: r.sourceId,
    entityName: r.sourceName,
    monthKey: r.monthKey,
    amountNis: r.amountNis,
  }));

/** Bar chart: one bar per lead source for a single selected month. */
export function buildSourceMediaSingleMonthChart(
  rows: SourceMediaCostBySourceRow[],
  monthKey: string,
): EntityBreakdownBarPoint[] {
  return buildSingleMonthEntityChart(sourceToEntityRows(rows), monthKey);
}

/** Stacked bars by month; top sources by year total, remainder as "Other". */
export function buildSourceMediaYearStackedChart(
  rows: SourceMediaCostBySourceRow[],
  monthKeys: string[],
  topSourceCount = 8,
): { chartData: EntityBreakdownStackedMonthPoint[]; series: { key: string; fill: string }[] } {
  return buildYearStackedEntityChart(sourceToEntityRows(rows), monthKeys, topSourceCount);
}
