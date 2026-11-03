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
  loans: 'Loans',
  paid_by_office: 'Paid by office',
} as const;

export type ExpenseCategoryKey = keyof typeof EXPENSE_CATEGORY_LABELS;

export const EXPENSE_CATEGORY_ORDER: ExpenseCategoryKey[] = [
  'source_media',
  'firm_management',
  'rent',
  'partner_draws',
  'salaries',
  'office',
  'loans',
  'paid_by_office',
];

export type ExpenseCategoryTotals = Record<ExpenseCategoryKey, number> & {
  /** Firm management costs with Marketing Expense type (rolled into marketing summary). */
  firm_management_marketing: number;
};

/** Every key a total is kept under, including the marketing slice of firm management. */
export type ExpenseTotalsKey = keyof ExpenseCategoryTotals;

/**
 * An amount split by whether the firm has actually paid it out.
 *
 * `overdue` is the part of `unpaid` that is already due: an expense month is treated as due at
 * month end, so anything left unpaid from a past month is debt today. Loan repayments carry a
 * real due date and use it instead.
 */
export type ExpensePaidSplit = {
  total: number;
  paid: number;
  unpaid: number;
  overdue: number;
};

export type ExpenseCategorySplits = Record<ExpenseTotalsKey, ExpensePaidSplit>;

export type MonthlyExpenseBreakdown = {
  monthKey: string;
  label: string;
  totals: ExpenseCategoryTotals;
  splits: ExpenseCategorySplits;
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
    loans: 0,
    paid_by_office: 0,
    firm_management_marketing: 0,
  };
}

export const EXPENSE_TOTALS_KEYS: ExpenseTotalsKey[] = [
  ...EXPENSE_CATEGORY_ORDER,
  'firm_management_marketing',
];

function emptySplit(): ExpensePaidSplit {
  return { total: 0, paid: 0, unpaid: 0, overdue: 0 };
}

export function emptyCategorySplits(): ExpenseCategorySplits {
  const out = {} as ExpenseCategorySplits;
  for (const key of EXPENSE_TOTALS_KEYS) out[key] = emptySplit();
  return out;
}

export function addExpenseSplits(a: ExpensePaidSplit, b: ExpensePaidSplit): ExpensePaidSplit {
  return {
    total: a.total + b.total,
    paid: a.paid + b.paid,
    unpaid: a.unpaid + b.unpaid,
    overdue: a.overdue + b.overdue,
  };
}

type SplitMap = Map<string, ExpensePaidSplit>;

function isPaidFlag(value: unknown): boolean {
  return value === true || value === 't' || value === 'true' || value === 1;
}

function todayIso(): string {
  const d = new Date();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${month}-${day}`;
}

function currentMonthKey(): string {
  return `${todayIso().slice(0, 7)}-01`;
}

/** An expense month is due at month end, so past months are already due and this month is not. */
function monthAlreadyDue(monthKey: string): boolean {
  return monthKey < currentMonthKey();
}

function addToSplitMap(
  map: SplitMap,
  monthKey: string,
  amount: number,
  paid: boolean,
  alreadyDue: boolean,
): void {
  const prev = map.get(monthKey) || emptySplit();
  map.set(monthKey, {
    total: prev.total + amount,
    paid: prev.paid + (paid ? amount : 0),
    unpaid: prev.unpaid + (paid ? 0 : amount),
    overdue: prev.overdue + (!paid && alreadyDue ? amount : 0),
  });
}

function mergeSplitMaps(a: SplitMap, b: SplitMap): SplitMap {
  const out: SplitMap = new Map(a);
  for (const [key, split] of b) {
    out.set(key, addExpenseSplits(out.get(key) || emptySplit(), split));
  }
  return out;
}

/**
 * True when the table or column this report wants does not exist yet, which is what a database
 * that has not run sql/2026-10-30_expense_paid_flags_loans_and_paid_by_office.sql looks like.
 */
function isMissingSchemaError(error: { code?: string; message?: string } | null): boolean {
  if (!error) return false;
  if (error.code === '42P01' || error.code === '42703' || error.code === 'PGRST205') return true;
  return /does not exist|schema cache/i.test(String(error.message || ''));
}

function salaryMonthKey(salaryYear: number, salaryMonth: number): string {
  return `${salaryYear}-${String(salaryMonth).padStart(2, '0')}-01`;
}

async function fetchSourceMediaByMonth(monthKeys: string[]): Promise<SplitMap> {
  const byMonth: SplitMap = new Map();
  if (monthKeys.length === 0) return byMonth;

  const { data, error } = await supabase
    .from('source_media_expense')
    .select('expense_month, amount, paid')
    .in('expense_month', monthKeys);

  if (error) throw error;

  for (const row of data || []) {
    const key = String(row.expense_month).slice(0, 10);
    addToSplitMap(byMonth, key, Number(row.amount) || 0, isPaidFlag(row.paid), monthAlreadyDue(key));
  }
  return byMonth;
}

async function fetchFirmManagementSplitByMonth(monthKeys: string[]): Promise<{
  firmManagement: SplitMap;
  marketing: SplitMap;
  rent: SplitMap;
  office: SplitMap;
}> {
  const firmManagement: SplitMap = new Map();
  const marketing: SplitMap = new Map();
  const rent: SplitMap = new Map();
  const office: SplitMap = new Map();
  if (monthKeys.length === 0) {
    return { firmManagement, marketing, rent, office };
  }

  const { data, error } = await supabase
    .from('firm_management_costs')
    .select('billing_month, amount, currency, paid, expense_types ( code )')
    .in('billing_month', monthKeys);

  if (error) throw error;

  for (const row of data || []) {
    const key = String(row.billing_month).slice(0, 10);
    const nis = managementAmountToNis(row.amount, row.currency);
    const paid = isPaidFlag(row.paid);
    const due = monthAlreadyDue(key);
    const typeRaw = row.expense_types as { code?: string | null } | { code?: string | null }[] | null;
    const code = (Array.isArray(typeRaw) ? typeRaw[0]?.code : typeRaw?.code) ?? null;

    if (code === EXPENSE_TYPE_CODE_RENT) {
      addToSplitMap(rent, key, nis, paid, due);
    } else if (code === EXPENSE_TYPE_CODE_MARKETING) {
      addToSplitMap(marketing, key, nis, paid, due);
    } else if (code === EXPENSE_TYPE_CODE_OFFICE) {
      addToSplitMap(office, key, nis, paid, due);
    } else {
      addToSplitMap(firmManagement, key, nis, paid, due);
    }
  }

  return { firmManagement, marketing, rent, office };
}

async function fetchRentByMonth(monthKeys: string[]): Promise<SplitMap> {
  const byMonth: SplitMap = new Map();
  if (monthKeys.length === 0) return byMonth;

  const { data, error } = await supabase
    .from('office_rent_expense')
    .select('expense_month, amount_nis, paid')
    .in('expense_month', monthKeys);

  if (error) throw error;

  for (const row of data || []) {
    const key = String(row.expense_month).slice(0, 10);
    addToSplitMap(byMonth, key, Number(row.amount_nis) || 0, isPaidFlag(row.paid), monthAlreadyDue(key));
  }
  return byMonth;
}

async function fetchPartnerDrawsByMonth(monthKeys: string[]): Promise<SplitMap> {
  const byMonth: SplitMap = new Map();
  if (monthKeys.length === 0) return byMonth;

  const { data, error } = await supabase
    .from('partner_draw_expense')
    .select('expense_month, amount_nis, paid')
    .in('expense_month', monthKeys);

  if (error) throw error;

  for (const row of data || []) {
    const key = String(row.expense_month).slice(0, 10);
    addToSplitMap(byMonth, key, Number(row.amount_nis) || 0, isPaidFlag(row.paid), monthAlreadyDue(key));
  }
  return byMonth;
}

async function fetchLoanPaymentsByMonth(monthKeys: string[]): Promise<SplitMap> {
  const byMonth: SplitMap = new Map();
  if (monthKeys.length === 0) return byMonth;

  const { data, error } = await supabase
    .from('loan_payment_expense')
    .select('expense_month, amount_nis, due_date, paid')
    .in('expense_month', monthKeys);

  if (error) {
    if (isMissingSchemaError(error)) {
      console.warn('loan_payment_expense is missing; loans will read as 0 until the migration runs');
      return byMonth;
    }
    throw error;
  }

  const today = todayIso();
  for (const row of data || []) {
    const key = String(row.expense_month).slice(0, 10);
    const dueDate = row.due_date ? String(row.due_date).slice(0, 10) : '';
    const due = dueDate ? dueDate < today : monthAlreadyDue(key);
    addToSplitMap(byMonth, key, Number(row.amount_nis) || 0, isPaidFlag(row.paid), due);
  }
  return byMonth;
}

async function fetchPaidByOfficeByMonth(monthKeys: string[]): Promise<SplitMap> {
  const byMonth: SplitMap = new Map();
  if (monthKeys.length === 0) return byMonth;

  const monthKeySet = new Set(monthKeys);
  const years = [...new Set(monthKeys.map(k => Number(k.slice(0, 4))))].filter(Number.isFinite);
  if (years.length === 0) return byMonth;

  const minYear = Math.min(...years);
  const maxYear = Math.max(...years);

  const { data, error } = await supabase
    .from('paid_by_office_expense')
    .select('expense_date, amount, currency, paid')
    .gte('expense_date', `${minYear}-01-01`)
    .lt('expense_date', `${maxYear + 1}-01-01`);

  if (error) {
    if (isMissingSchemaError(error)) {
      console.warn('paid_by_office_expense is missing; the category will read as 0 until the migration runs');
      return byMonth;
    }
    throw error;
  }

  for (const row of data || []) {
    const date = String(row.expense_date || '').slice(0, 10);
    if (date.length < 7) continue;
    const monthKey = `${date.slice(0, 7)}-01`;
    if (!monthKeySet.has(monthKey)) continue;
    addToSplitMap(
      byMonth,
      monthKey,
      managementAmountToNis(row.amount, row.currency),
      isPaidFlag(row.paid),
      monthAlreadyDue(monthKey),
    );
  }
  return byMonth;
}

async function fetchOfficeExpensesByMonth(monthKeys: string[]): Promise<SplitMap> {
  const byMonth: SplitMap = new Map();
  if (monthKeys.length === 0) return byMonth;

  const monthKeySet = new Set(monthKeys);
  const years = [...new Set(monthKeys.map(k => Number(k.slice(0, 4))))].filter(Number.isFinite);
  if (years.length === 0) return byMonth;

  const minYear = Math.min(...years);
  const maxYear = Math.max(...years);

  const { data, error } = await supabase
    .from('office_expenses')
    .select('created_at, amount, currency, paid')
    .gte('created_at', `${minYear}-01-01`)
    .lt('created_at', `${maxYear + 1}-01-01`);

  if (error) throw error;

  for (const row of data || []) {
    const created = String(row.created_at || '').slice(0, 10);
    if (created.length < 7) continue;
    const monthKey = `${created.slice(0, 7)}-01`;
    if (!monthKeySet.has(monthKey)) continue;
    addToSplitMap(
      byMonth,
      monthKey,
      managementAmountToNis(row.amount, row.currency),
      isPaidFlag(row.paid),
      monthAlreadyDue(monthKey),
    );
  }
  return byMonth;
}

async function fetchSalariesByMonth(monthKeys: string[]): Promise<SplitMap> {
  const byMonth: SplitMap = new Map();
  if (monthKeys.length === 0) return byMonth;

  const monthKeySet = new Set(monthKeys);
  const years = [...new Set(monthKeys.map(k => Number(k.slice(0, 4))))].filter(Number.isFinite);
  if (years.length === 0) return byMonth;

  const minYear = Math.min(...years);
  const maxYear = Math.max(...years);

  const { data, error } = await supabase
    .from('employee_salary')
    .select('gross_salary, salary_month, salary_year, paid')
    .gte('salary_year', minYear)
    .lte('salary_year', maxYear);

  if (error) throw error;

  for (const row of data || []) {
    const key = salaryMonthKey(Number(row.salary_year), Number(row.salary_month));
    if (!monthKeySet.has(key)) continue;
    addToSplitMap(byMonth, key, Number(row.gross_salary) || 0, isPaidFlag(row.paid), monthAlreadyDue(key));
  }
  return byMonth;
}

export function mergeMonthlyBreakdown(
  monthKeys: string[],
  maps: {
    sourceMedia: SplitMap;
    firmManagement: SplitMap;
    rent: SplitMap;
    partnerDraws: SplitMap;
    salaries: SplitMap;
    office: SplitMap;
    loans: SplitMap;
    paidByOffice: SplitMap;
    firmManagementMarketing: SplitMap;
    firmManagementRent: SplitMap;
    firmManagementOffice: SplitMap;
  },
): MonthlyExpenseBreakdown[] {
  // Firm management lines typed as rent or office belong to those categories, so the two maps
  // are merged before anything is read per month.
  const rent = mergeSplitMaps(maps.rent, maps.firmManagementRent);
  const office = mergeSplitMaps(maps.office, maps.firmManagementOffice);

  const byCategory: Record<ExpenseTotalsKey, SplitMap> = {
    source_media: maps.sourceMedia,
    firm_management: maps.firmManagement,
    rent,
    partner_draws: maps.partnerDraws,
    salaries: maps.salaries,
    office,
    loans: maps.loans,
    paid_by_office: maps.paidByOffice,
    firm_management_marketing: maps.firmManagementMarketing,
  };

  return monthKeys.map(monthKey => {
    const splits = emptyCategorySplits();
    const totals = emptyCategoryTotals();
    for (const key of EXPENSE_TOTALS_KEYS) {
      const split = byCategory[key].get(monthKey) || emptySplit();
      splits[key] = split;
      totals[key] = split.total;
    }
    const totalNis =
      EXPENSE_CATEGORY_ORDER.reduce((sum, key) => sum + totals[key], 0) +
      totals.firm_management_marketing;
    return {
      monthKey,
      label: formatMonthKeyLabel(monthKey),
      totals,
      splits,
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

export function sumCategorySplits(rows: MonthlyExpenseBreakdown[]): ExpenseCategorySplits {
  const out = emptyCategorySplits();
  for (const row of rows) {
    for (const key of EXPENSE_TOTALS_KEYS) {
      out[key] = addExpenseSplits(out[key], row.splits?.[key] || emptySplit());
    }
  }
  return out;
}

export function marketingExpenseTotal(totals: ExpenseCategoryTotals): number {
  return totals.source_media + totals.firm_management_marketing;
}

/** Marketing as the summary boxes show it: source media plus firm management marketing lines. */
export function marketingExpenseSplit(splits: ExpenseCategorySplits): ExpensePaidSplit {
  return addExpenseSplits(splits.source_media, splits.firm_management_marketing);
}

/** What the firm still owes: unpaid lines whose due date has passed. */
export function expenseDebtTotal(splits: ExpenseCategorySplits): number {
  return EXPENSE_CATEGORY_ORDER.reduce((sum, key) => sum + splits[key].overdue, 0) +
    splits.firm_management_marketing.overdue;
}

export async function fetchAllExpensesBreakdown(monthKeys: string[]): Promise<MonthlyExpenseBreakdown[]> {
  const [
    sourceMedia,
    firmManagementSplit,
    rent,
    partnerDraws,
    salaries,
    office,
    loans,
    paidByOffice,
  ] = await Promise.all([
    fetchSourceMediaByMonth(monthKeys),
    fetchFirmManagementSplitByMonth(monthKeys),
    fetchRentByMonth(monthKeys),
    fetchPartnerDrawsByMonth(monthKeys),
    fetchSalariesByMonth(monthKeys),
    fetchOfficeExpensesByMonth(monthKeys),
    fetchLoanPaymentsByMonth(monthKeys),
    fetchPaidByOfficeByMonth(monthKeys),
  ]);

  return mergeMonthlyBreakdown(monthKeys, {
    sourceMedia,
    firmManagement: firmManagementSplit.firmManagement,
    rent,
    partnerDraws,
    salaries,
    office,
    loans,
    paidByOffice,
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
