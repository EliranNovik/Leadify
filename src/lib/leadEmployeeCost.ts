import { supabase } from './supabase';
import {
  convertToNIS,
  ensureBoiRatesReady,
  type CurrencyInput,
} from './boiCurrencyConversion';
import {
  allocationEmployeeDateKey,
  allocationPercentToWorkedMs,
  buildAllocationClockInMsByEmployeeDate,
  formatAllocationCostNis,
  formatAllocationWorkedDuration,
  normalizeEmployeeMinHours,
  salaryToHourlyRateNis,
  SALARY_COST_HOURS_PER_MONTH,
  workedMsAtHourlyRateToCostNis,
} from './employeeLeadReporting';
import { fetchAverageGrossSalaryLastMonths } from './employeeSalaries';
import { isExpenseNoVatPayment } from './proformaVat';
import { fetchClockInRecordsForAllocationMs } from './workingHoursExport';
import {
  fetchApprovedBudgetExtensionNis,
} from './leadBudgetExtensionRequests';
import {
  fetchLeadCostMaxOverrideNis,
  resolveEffectiveMaxAllowedCostNis,
} from './leadEmployeeCostMaxOverride';

/** Share of lead total value treated as operating pool. */
export const LEAD_VALUE_OPERATING_SHARE = 0.87;
/** Max employee cost as a share of the operating pool (14% of 87%). */
export const LEAD_EMPLOYEE_COST_OF_OPERATING_SHARE = 0.14;

export function maxLeadEmployeeCostNis(leadTotalValueNis: number): number {
  const value = Math.max(0, Number(leadTotalValueNis) || 0);
  return (
    Math.round(value * LEAD_VALUE_OPERATING_SHARE * LEAD_EMPLOYEE_COST_OF_OPERATING_SHARE * 100) / 100
  );
}

/** Resolve lead / accounting currency for BOI conversion. */
export function resolveLeadCurrencyInput(client: any): CurrencyInput {
  if (!client) return 1;
  const accounting = client.accounting_currencies;
  const rec = Array.isArray(accounting) ? accounting[0] : accounting;
  if (rec?.iso_code) return String(rec.iso_code);
  if (client.currency_id != null && client.currency_id !== '') return client.currency_id;
  if (client.balance_currency) return client.balance_currency;
  if (client.proposal_currency) return client.proposal_currency;
  return 1;
}

/**
 * Lead total value in NIS for employee-cost / budget caps.
 * Converts base + subcontractor fee via BOI (`boiCurrencyConversion`).
 * Prefer `firmPaidExpenseTotalNis` (from {@link fetchFirmPaidExpenseReductionTotalNis}).
 */
export async function resolveLeadTotalValueNis(
  client: any,
  options?: {
    hasPaymentPlan?: boolean | null;
    /** Payment plan base in lead/plan currency (converted with lead currency unless already NIS). */
    paymentPlanBaseTotal?: number | null;
    /** When true, `paymentPlanBaseTotal` is already NIS. */
    paymentPlanBaseTotalIsNis?: boolean;
    /**
     * Firm-paid expenses already in NIS.
     * Prefer this over `firmPaidExpenseTotal`.
     */
    firmPaidExpenseTotalNis?: number | null;
    /**
     * Firm-paid expenses in lead currency (converted with lead currency when
     * `firmPaidExpenseTotalNis` is omitted). Prefer the NIS fetch for mixed currencies.
     */
    firmPaidExpenseTotal?: number | null;
  },
): Promise<number> {
  if (!client) return 0;

  const snapshot = await ensureBoiRatesReady();
  const currency = resolveLeadCurrencyInput(client);

  const isLegacy =
    client.lead_type === 'legacy' || String(client.id ?? '').startsWith('legacy_');

  let baseAmount = 0;
  if (isLegacy) {
    const currencyId = client.currency_id;
    let numericCurrencyId =
      typeof currencyId === 'string' ? parseInt(currencyId, 10) : Number(currencyId);
    if (!numericCurrencyId || Number.isNaN(numericCurrencyId)) numericCurrencyId = 1;
    baseAmount =
      numericCurrencyId === 1
        ? Number(client.total_base ?? 0)
        : Number(client.total ?? 0);
  } else {
    baseAmount = Number(client.balance || client.proposal_total || 0);
  }

  let baseNis: number;
  if (options?.hasPaymentPlan === true && options.paymentPlanBaseTotal != null) {
    const planBase = Number(options.paymentPlanBaseTotal) || 0;
    baseNis = options.paymentPlanBaseTotalIsNis
      ? planBase
      : convertToNIS(planBase, currency, snapshot);
  } else {
    baseNis = convertToNIS(baseAmount, currency, snapshot);
  }

  const subcontractorFee = Number(client.subcontractor_fee ?? 0);
  const feeNis =
    Number.isFinite(subcontractorFee) && subcontractorFee > 0
      ? convertToNIS(subcontractorFee, currency, snapshot)
      : 0;

  const firmExpenseNis =
    options?.firmPaidExpenseTotalNis != null
      ? Math.max(0, Number(options.firmPaidExpenseTotalNis) || 0)
      : convertToNIS(
          Math.max(0, Number(options?.firmPaidExpenseTotal ?? 0) || 0),
          currency,
          snapshot,
        );

  const netAmount = baseNis - feeNis - firmExpenseNis;
  return Number.isFinite(netAmount) ? Math.max(0, Math.round(netAmount * 100) / 100) : 0;
}

/**
 * Contract payment-plan base total in NIS (per-row BOI conversion).
 * Returns null when there is no plan or only expense rows (caller should fall back to lead balance).
 */
export async function fetchLeadPaymentPlanBaseTotalNis(client: any): Promise<number | null> {
  if (!client?.id) return null;

  const isLegacy =
    client.lead_type === 'legacy' || String(client.id ?? '').startsWith('legacy_');

  if (isLegacy) {
    const rawId = String(client.id).replace(/^legacy_/, '');
    const legacyId = Number(rawId);
    if (!Number.isFinite(legacyId) || legacyId <= 0) return null;

    const { data, error } = await supabase
      .from('finances_paymentplanrow')
      .select('value, order, currency_id')
      .eq('lead_id', legacyId)
      .is('cancel_date', null);
    if (error || !data?.length) return null;

    const snapshot = await ensureBoiRatesReady();
    let baseTotalNis = 0;
    let hasContract = false;
    for (const row of data as Array<{
      value?: unknown;
      order?: unknown;
      currency_id?: number | string | null;
    }>) {
      if (isExpenseNoVatPayment(row.order as string | number | null | undefined)) continue;
      hasContract = true;
      const base = Number(row.value ?? 0);
      if (!Number.isFinite(base) || !(base > 0)) continue;
      baseTotalNis += convertToNIS(base, row.currency_id ?? 1, snapshot);
    }
    return hasContract ? Math.round(baseTotalNis * 100) / 100 : null;
  }

  const leadId = String(client.id);
  const { data, error } = await supabase
    .from('payment_plans')
    .select('id, value, payment_order, currency_id, currency')
    .or(`lead_id.eq.${leadId},lead_ids.eq.${leadId}`)
    .is('cancel_date', null);
  if (error || !data?.length) return null;

  const seen = new Set<string>();
  const rows = (data as Array<{
    id?: unknown;
    value?: unknown;
    payment_order?: unknown;
    currency_id?: number | string | null;
    currency?: string | null;
  }>).filter((r) => {
    const key = r?.id != null ? String(r.id) : JSON.stringify(r);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  if (rows.length === 0) return null;

  const snapshot = await ensureBoiRatesReady();
  let baseTotalNis = 0;
  let hasContract = false;
  for (const row of rows) {
    if (isExpenseNoVatPayment(row.payment_order as string | number | null | undefined)) continue;
    hasContract = true;
    const base = Number(row.value ?? 0);
    if (!Number.isFinite(base) || !(base > 0)) continue;
    const currency =
      row.currency_id != null && row.currency_id !== ''
        ? row.currency_id
        : row.currency ?? 1;
    baseTotalNis += convertToNIS(base, currency, snapshot);
  }
  return hasContract ? Math.round(baseTotalNis * 100) / 100 : null;
}

export type LeadEmployeeCostRow = {
  employeeId: number;
  employeeName: string;
  photoUrl: string | null;
  departmentName: string | null;
  workedMs: number;
  costNis: number;
  hourRateNis: number | null;
};

export type LeadEmployeeCostSummary = {
  employees: LeadEmployeeCostRow[];
  totalWorkedMs: number;
  totalCostNis: number;
  /** Base max from lead value (14% of 87%) */
  baseMaxAllowedCostNis: number;
  /** Approved management extensions (extra budget without changing lead value) */
  approvedExtensionCostNis: number;
  /** Absolute management override; when set, replaces formula + extensions. */
  maxOverrideNis: number | null;
  /** Effective max = override OR (base + extensions) */
  maxAllowedCostNis: number;
  leadTotalValueNis: number;
  exceedsCap: boolean;
  utilizationPercent: number;
  /**
   * True when there is no allocation report data and rates come from assigned
   * Handler / R-Handler salaries ÷ {@link SALARY_COST_HOURS_PER_MONTH}.
   */
  usedRoleHourlyFallback?: boolean;
};

/** @deprecated Use {@link SALARY_COST_HOURS_PER_MONTH} from employeeLeadReporting. */
export const LEAD_COST_FALLBACK_HOURS_PER_MONTH = SALARY_COST_HOURS_PER_MONTH;

/** Case handler + retention handler employee ids from a lead row. */
export function resolveAssignedHandlerEmployeeIds(client: any): number[] {
  if (!client) return [];
  const ids = new Set<number>();
  const add = (raw: unknown) => {
    if (raw == null || raw === '' || raw === '---' || raw === '--') return;
    const n = typeof raw === 'number' ? raw : Number(String(raw).trim());
    if (Number.isFinite(n) && n > 0) ids.add(n);
  };

  add(client.case_handler_id);
  add(client.retainer_handler_id);

  // Legacy / alternate fields when case_handler_id is empty
  if (client.case_handler_id == null || String(client.case_handler_id).trim() === '') {
    const handler = client.handler;
    if (typeof handler === 'number' || (typeof handler === 'string' && /^\d+$/.test(handler.trim()))) {
      add(handler);
    }
  }

  return Array.from(ids);
}

type AllocationItemJoin = {
  id: number;
  percent: number;
  lead_number: string | null;
  lead_type: string | null;
  new_lead_id: string | null;
  legacy_lead_id: number | null;
  employee_daily_lead_allocations: {
    employee_id: number;
    work_date: string;
    tenants_employee:
      | {
          id: number;
          display_name: string | null;
          photo_url: string | null;
          photo: string | null;
          min_hours: number | null;
          department_id: number | null;
          tenant_departement:
            | { id: number; name: string | null }
            | { id: number; name: string | null }[]
            | null;
        }
      | {
          id: number;
          display_name: string | null;
          photo_url: string | null;
          photo: string | null;
          min_hours: number | null;
          department_id: number | null;
          tenant_departement:
            | { id: number; name: string | null }
            | { id: number; name: string | null }[]
            | null;
        }[]
      | null;
  } | null;
};

export type LeadIdentityForCost = {
  isLegacy: boolean;
  newLeadId: string | null;
  legacyLeadId: number | null;
  leadNumber: string | null;
};

function isUuidLeadId(value: string | null | undefined): boolean {
  if (!value) return false;
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    value.trim(),
  );
}

export function resolveLeadIdentityForCost(client: any): LeadIdentityForCost | null {
  if (!client) return null;
  const isLegacy =
    client.lead_type === 'legacy' || String(client.id ?? '').startsWith('legacy_');
  const leadNumber =
    String(client.lead_number ?? client.manual_id ?? '').trim() || null;

  if (isLegacy) {
    const raw = String(client.id ?? '').replace(/^legacy_/i, '');
    const legacyLeadId = Number(raw);
    return {
      isLegacy: true,
      newLeadId: null,
      legacyLeadId: Number.isFinite(legacyLeadId) && legacyLeadId > 0 ? legacyLeadId : null,
      leadNumber,
    };
  }

  const idStr = client.id != null ? String(client.id).trim() : '';
  // Never treat a lead_number (e.g. "L209994/3") as new_lead_id — that skips real
  // allocation rows and triggers the Handler salary fallback (false over-budget).
  const newLeadId = isUuidLeadId(idStr) ? idStr : null;

  return {
    isLegacy: false,
    newLeadId,
    legacyLeadId: null,
    leadNumber,
  };
}

/**
 * Fallback only: used when the lead has no allocation-report rows yet.
 * Once real allocated hours exist in the report, {@link fetchLeadEmployeeCostSummary}
 * uses those rows exclusively and never merges this estimate.
 */
async function buildHandlerRoleHourlyFallbackSummary(params: {
  client: any;
  base: LeadEmployeeCostSummary;
}): Promise<LeadEmployeeCostSummary> {
  const employeeIds = resolveAssignedHandlerEmployeeIds(params.client);
  if (employeeIds.length === 0) {
    return { ...params.base, usedRoleHourlyFallback: false };
  }

  const [{ data: empRows, error: empError }, salaryMap] = await Promise.all([
    supabase
      .from('tenants_employee')
      .select(
        `
        id,
        display_name,
        photo_url,
        photo,
        department_id,
        tenant_departement!department_id ( id, name )
      `,
      )
      .in('id', employeeIds),
    fetchAverageGrossSalaryLastMonths(employeeIds, 6),
  ]);

  if (empError) {
    console.error('[leadEmployeeCost] handler fallback employee fetch failed:', empError);
    throw empError;
  }

  type EmpRow = {
    id: number;
    display_name: string | null;
    photo_url: string | null;
    photo: string | null;
    tenant_departement:
      | { id: number; name: string | null }
      | { id: number; name: string | null }[]
      | null;
  };

  const byId = new Map<number, EmpRow>();
  for (const row of (empRows || []) as EmpRow[]) {
    if (row?.id != null) byId.set(Number(row.id), row);
  }

  const employees: LeadEmployeeCostRow[] = employeeIds
    .map((employeeId) => {
      const emp = byId.get(employeeId);
      const deptRaw = emp?.tenant_departement;
      const dept = Array.isArray(deptRaw) ? deptRaw[0] : deptRaw;
      const avgSalary = salaryMap.get(employeeId) ?? 0;
      const hourRateNis = salaryToHourlyRateNis(avgSalary > 0 ? avgSalary : null);
      return {
        employeeId,
        employeeName: emp?.display_name?.trim() || `Employee #${employeeId}`,
        photoUrl:
          (typeof emp?.photo_url === 'string' && emp.photo_url.trim()) ||
          (typeof emp?.photo === 'string' && emp.photo.trim()) ||
          null,
        departmentName: dept?.name?.trim() || null,
        workedMs: 0,
        costNis: 0,
        hourRateNis,
      };
    })
    .filter((row) => row.hourRateNis != null && row.hourRateNis > 0)
    .sort((a, b) => a.employeeName.localeCompare(b.employeeName));

  if (employees.length === 0) {
    return { ...params.base, usedRoleHourlyFallback: false };
  }

  return {
    ...params.base,
    employees,
    totalWorkedMs: 0,
    totalCostNis: 0,
    exceedsCap: false,
    utilizationPercent: 0,
    usedRoleHourlyFallback: true,
  };
}

/**
 * Loads all time-allocation rows for a lead, applies salary-derived hourly rates,
 * and aggregates cost / worked time per employee.
 *
 * Fallback (Handler / R-Handler salary ÷ 127h) runs only when there is no real
 * allocation-report data. As soon as report rows exist, they replace the fallback
 * entirely — no mixing of estimated and reported hours.
 * Hourly rates always use {@link SALARY_COST_HOURS_PER_MONTH} (127), not employee min_hours.
 */
export async function fetchLeadEmployeeCostSummary(params: {
  client: any;
  leadTotalValueNis: number;
}): Promise<LeadEmployeeCostSummary> {
  const leadTotalValueNis = Math.max(0, Number(params.leadTotalValueNis) || 0);
  const baseMaxAllowedCostNis = maxLeadEmployeeCostNis(leadTotalValueNis);
  const identity = resolveLeadIdentityForCost(params.client);
  const [approvedExtensionCostNis, maxOverrideNis] = identity
    ? await Promise.all([
        fetchApprovedBudgetExtensionNis({
          leadType: identity.isLegacy ? 'legacy' : 'new',
          newLeadId: identity.newLeadId,
          legacyLeadId: identity.legacyLeadId,
          leadNumber: identity.leadNumber,
        }),
        fetchLeadCostMaxOverrideNis({
          leadType: identity.isLegacy ? 'legacy' : 'new',
          newLeadId: identity.newLeadId,
          legacyLeadId: identity.legacyLeadId,
          leadNumber: identity.leadNumber,
        }),
      ])
    : [0, null];
  const maxAllowedCostNis = resolveEffectiveMaxAllowedCostNis({
    baseMaxAllowedCostNis,
    approvedExtensionCostNis,
    maxOverrideNis,
  });

  const empty: LeadEmployeeCostSummary = {
    employees: [],
    totalWorkedMs: 0,
    totalCostNis: 0,
    baseMaxAllowedCostNis,
    approvedExtensionCostNis,
    maxOverrideNis,
    maxAllowedCostNis,
    leadTotalValueNis,
    exceedsCap: false,
    utilizationPercent: 0,
    usedRoleHourlyFallback: false,
  };

  if (!identity) return empty;

  let query = supabase.from('employee_daily_lead_allocation_items').select(
    `
      id,
      percent,
      lead_number,
      lead_type,
      new_lead_id,
      legacy_lead_id,
      employee_daily_lead_allocations!inner (
        employee_id,
        work_date,
        tenants_employee!employee_id (
          id,
          display_name,
          photo_url,
          photo,
          min_hours,
          department_id,
          tenant_departement!department_id ( id, name )
        )
      )
    `,
  );

  if (identity.isLegacy && identity.legacyLeadId != null) {
    query = query.eq('legacy_lead_id', identity.legacyLeadId);
  } else if (!identity.isLegacy && identity.newLeadId) {
    query = query.eq('new_lead_id', identity.newLeadId);
  } else if (identity.leadNumber) {
    query = query.eq('lead_number', identity.leadNumber);
  } else {
    return empty;
  }

  let { data, error } = await query;
  if (error) {
    console.error('[leadEmployeeCost] allocation fetch failed:', error);
    throw error;
  }

  let items = (data || []) as AllocationItemJoin[];
  // If UUID match returned nothing, retry by lead_number (older rows may lack new_lead_id).
  if (
    items.length === 0 &&
    !identity.isLegacy &&
    identity.newLeadId &&
    identity.leadNumber
  ) {
    const retry = await supabase
      .from('employee_daily_lead_allocation_items')
      .select(
        `
      id,
      percent,
      lead_number,
      lead_type,
      new_lead_id,
      legacy_lead_id,
      employee_daily_lead_allocations!inner (
        employee_id,
        work_date,
        tenants_employee!employee_id (
          id,
          display_name,
          photo_url,
          photo,
          min_hours,
          department_id,
          tenant_departement!department_id ( id, name )
        )
      )
    `,
      )
      .eq('lead_number', identity.leadNumber);
    if (retry.error) {
      console.error('[leadEmployeeCost] allocation lead_number retry failed:', retry.error);
      throw retry.error;
    }
    items = (retry.data || []) as AllocationItemJoin[];
  }
  // Fallback is ONLY when this lead has no real allocation-report rows.
  // Any saved allocation item with percent > 0 fully replaces the Handler/R-Handler 127h estimate.
  const hasRealAllocationReportData = items.some(
    (item) =>
      item.employee_daily_lead_allocations != null &&
      Number(item.percent) > 0,
  );
  if (!hasRealAllocationReportData) {
    return buildHandlerRoleHourlyFallbackSummary({
      client: params.client,
      base: empty,
    });
  }

  const employeeIds = new Set<number>();
  let minDate = items[0]?.employee_daily_lead_allocations?.work_date || '';
  let maxDate = minDate;

  for (const item of items) {
    const alloc = item.employee_daily_lead_allocations;
    if (!alloc) continue;
    employeeIds.add(alloc.employee_id);
    if (alloc.work_date < minDate) minDate = alloc.work_date;
    if (alloc.work_date > maxDate) maxDate = alloc.work_date;
  }

  const [salaryMap, clockRecords] = await Promise.all([
    fetchAverageGrossSalaryLastMonths(Array.from(employeeIds), 6),
    minDate && maxDate
      ? fetchClockInRecordsForAllocationMs(minDate, maxDate)
      : Promise.resolve([]),
  ]);

  // Prefer pending/approved “Lead allocation hours” sessions (same as allocation report).
  const clockMsByEmpDate = buildAllocationClockInMsByEmployeeDate(clockRecords);

  type Agg = {
    employeeId: number;
    employeeName: string;
    photoUrl: string | null;
    departmentName: string | null;
    minHours: number;
    workedMs: number;
    costNis: number;
    hourRateNis: number | null;
  };

  const byEmployee = new Map<number, Agg>();

  for (const item of items) {
    const alloc = item.employee_daily_lead_allocations;
    if (!alloc) continue;
    const empRaw = alloc.tenants_employee;
    const emp = Array.isArray(empRaw) ? empRaw[0] : empRaw;
    const deptRaw = emp?.tenant_departement;
    const dept = Array.isArray(deptRaw) ? deptRaw[0] : deptRaw;

    const employeeId = alloc.employee_id;
    const minHours = normalizeEmployeeMinHours(emp?.min_hours);
    const avgSalary = salaryMap.get(employeeId) ?? 0;
    const hourRateNis = salaryToHourlyRateNis(avgSalary > 0 ? avgSalary : null, minHours);
    const dayWorkedMs =
      clockMsByEmpDate.get(allocationEmployeeDateKey(employeeId, alloc.work_date)) ?? 0;
    const workedMs = allocationPercentToWorkedMs(dayWorkedMs, Number(item.percent) || 0);
    const costNis = workedMsAtHourlyRateToCostNis(workedMs, hourRateNis) ?? 0;

    let agg = byEmployee.get(employeeId);
    if (!agg) {
      agg = {
        employeeId,
        employeeName: emp?.display_name?.trim() || `Employee #${employeeId}`,
        photoUrl:
          (typeof emp?.photo_url === 'string' && emp.photo_url.trim()) ||
          (typeof emp?.photo === 'string' && emp.photo.trim()) ||
          null,
        departmentName: dept?.name?.trim() || null,
        minHours,
        workedMs: 0,
        costNis: 0,
        hourRateNis,
      };
      byEmployee.set(employeeId, agg);
    }

    agg.workedMs += workedMs;
    agg.costNis += costNis;
    if (hourRateNis != null) agg.hourRateNis = hourRateNis;
  }

  const employees: LeadEmployeeCostRow[] = Array.from(byEmployee.values())
    .map((agg) => ({
      employeeId: agg.employeeId,
      employeeName: agg.employeeName,
      photoUrl: agg.photoUrl,
      departmentName: agg.departmentName,
      workedMs: agg.workedMs,
      costNis: Math.round(agg.costNis * 100) / 100,
      hourRateNis: agg.hourRateNis,
    }))
    .sort((a, b) => b.costNis - a.costNis || a.employeeName.localeCompare(b.employeeName));

  const totalWorkedMs = employees.reduce((sum, row) => sum + row.workedMs, 0);
  const totalCostNis =
    Math.round(employees.reduce((sum, row) => sum + row.costNis, 0) * 100) / 100;
  const exceedsCap =
    maxAllowedCostNis > 0
      ? totalCostNis > maxAllowedCostNis + 0.005
      : totalCostNis > 0.005 || totalWorkedMs > 0;
  const utilizationPercent =
    maxAllowedCostNis > 0
      ? Math.round((totalCostNis / maxAllowedCostNis) * 1000) / 10
      : totalCostNis > 0 || totalWorkedMs > 0
        ? 100
        : 0;

  return {
    employees,
    totalWorkedMs,
    totalCostNis,
    baseMaxAllowedCostNis,
    approvedExtensionCostNis,
    maxOverrideNis,
    maxAllowedCostNis,
    leadTotalValueNis,
    exceedsCap,
    utilizationPercent,
    usedRoleHourlyFallback: false,
  };
}

/**
 * Spent / left / max time from a cost summary — same math as Clients `LeadRemainingTimeBar`.
 */
export function remainingTimeFromLeadCostSummary(summary: LeadEmployeeCostSummary): {
  remainingCostNis: number;
  remainingWorkedMs: number | null;
  spentWorkedMs: number;
  totalBudgetWorkedMs: number | null;
  utilizationPercent: number;
  exceeds: boolean;
} {
  const exceeds = summary.exceedsCap === true;
  const spentWorkedMs = Math.max(0, Number(summary.totalWorkedMs) || 0);
  const remainingCostNis = Math.max(
    0,
    Math.round((summary.maxAllowedCostNis - summary.totalCostNis) * 100) / 100,
  );
  const hoursWorked = spentWorkedMs > 0 ? spentWorkedMs / (60 * 60 * 1000) : 0;
  let hourRateNis: number | null = null;
  if (hoursWorked > 0.001 && summary.totalCostNis > 0) {
    hourRateNis = summary.totalCostNis / hoursWorked;
  } else {
    const rates = summary.employees
      .map((e) => e.hourRateNis)
      .filter((r): r is number => r != null && r > 0);
    if (rates.length > 0) {
      hourRateNis = rates.reduce((sum, r) => sum + r, 0) / rates.length;
    }
  }
  const remainingWorkedMs =
    !exceeds && hourRateNis != null && hourRateNis > 0
      ? Math.round((remainingCostNis / hourRateNis) * 60 * 60 * 1000)
      : exceeds
        ? 0
        : null;

  const totalBudgetWorkedMs =
    remainingWorkedMs != null
      ? spentWorkedMs + remainingWorkedMs
      : hourRateNis != null && hourRateNis > 0 && summary.maxAllowedCostNis > 0
        ? Math.round((summary.maxAllowedCostNis / hourRateNis) * 60 * 60 * 1000)
        : null;

  return {
    remainingCostNis,
    remainingWorkedMs,
    spentWorkedMs,
    totalBudgetWorkedMs,
    utilizationPercent: summary.utilizationPercent,
    exceeds,
  };
}

export { formatAllocationCostNis, formatAllocationWorkedDuration };
