import { supabase } from './supabase';
import { filterCountedClockInRecords } from './employeeClockInApproval';
import {
  allocationPercentToWorkedMs,
  formatAllocationCostNis,
  formatAllocationWorkedDuration,
  getJerusalemTodayIsoDate,
  normalizeEmployeeMinHours,
  salaryToHourlyRateNis,
  workedMsAtHourlyRateToCostNis,
} from './employeeLeadReporting';
import { fetchAverageGrossSalaryLastMonths } from './employeeSalaries';
import { fetchClockInRecordsInRangeForReport } from './workingHoursExport';

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

export function resolveLeadTotalValueNis(
  client: any,
  options?: {
    hasPaymentPlan?: boolean | null;
    paymentPlanBaseTotal?: number | null;
  },
): number {
  if (!client) return 0;

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

  if (options?.hasPaymentPlan === true && options.paymentPlanBaseTotal != null) {
    baseAmount = Number(options.paymentPlanBaseTotal) || 0;
  }

  return Number.isFinite(baseAmount) ? Math.max(0, baseAmount) : 0;
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
  maxAllowedCostNis: number;
  leadTotalValueNis: number;
  exceedsCap: boolean;
  utilizationPercent: number;
};

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

function employeeDateKey(employeeId: number, workDate: string): string {
  return `${employeeId}|${workDate}`;
}

function buildClockInMsByEmployeeDate(
  records: { employee_id?: number | null; clock_in_time: string; clock_out_time: string | null }[],
): Map<string, number> {
  const counted = filterCountedClockInRecords(records as any);
  const totals = new Map<string, number>();
  const now = Date.now();

  for (const record of counted) {
    const employeeId = record.employee_id;
    if (employeeId == null) continue;
    const dateKey = getJerusalemTodayIsoDate(new Date(record.clock_in_time));
    const start = new Date(record.clock_in_time).getTime();
    const end = record.clock_out_time ? new Date(record.clock_out_time).getTime() : now;
    const durationMs = Math.max(0, end - start);
    const key = employeeDateKey(employeeId, dateKey);
    totals.set(key, (totals.get(key) ?? 0) + durationMs);
  }

  return totals;
}

export type LeadIdentityForCost = {
  isLegacy: boolean;
  newLeadId: string | null;
  legacyLeadId: number | null;
  leadNumber: string | null;
};

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

  return {
    isLegacy: false,
    newLeadId: client.id != null ? String(client.id) : null,
    legacyLeadId: null,
    leadNumber,
  };
}

/**
 * Loads all time-allocation rows for a lead, applies salary-derived hourly rates,
 * and aggregates cost / worked time per employee.
 */
export async function fetchLeadEmployeeCostSummary(params: {
  client: any;
  leadTotalValueNis: number;
}): Promise<LeadEmployeeCostSummary> {
  const leadTotalValueNis = Math.max(0, Number(params.leadTotalValueNis) || 0);
  const maxAllowedCostNis = maxLeadEmployeeCostNis(leadTotalValueNis);
  const empty: LeadEmployeeCostSummary = {
    employees: [],
    totalWorkedMs: 0,
    totalCostNis: 0,
    maxAllowedCostNis,
    leadTotalValueNis,
    exceedsCap: false,
    utilizationPercent: 0,
  };

  const identity = resolveLeadIdentityForCost(params.client);
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

  const { data, error } = await query;
  if (error) {
    console.error('[leadEmployeeCost] allocation fetch failed:', error);
    throw error;
  }

  const items = (data || []) as AllocationItemJoin[];
  if (items.length === 0) return empty;

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
      ? fetchClockInRecordsInRangeForReport(minDate, maxDate)
      : Promise.resolve([]),
  ]);

  const clockMsByEmpDate = buildClockInMsByEmployeeDate(clockRecords);

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
    const dayWorkedMs = clockMsByEmpDate.get(employeeDateKey(employeeId, alloc.work_date)) ?? 0;
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
  const exceedsCap = maxAllowedCostNis > 0 && totalCostNis > maxAllowedCostNis + 0.005;
  const utilizationPercent =
    maxAllowedCostNis > 0
      ? Math.round((totalCostNis / maxAllowedCostNis) * 1000) / 10
      : totalCostNis > 0
        ? 100
        : 0;

  return {
    employees,
    totalWorkedMs,
    totalCostNis,
    maxAllowedCostNis,
    leadTotalValueNis,
    exceedsCap,
    utilizationPercent,
  };
}

export { formatAllocationCostNis, formatAllocationWorkedDuration };
