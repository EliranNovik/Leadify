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
  type LeadReportingType,
} from './employeeLeadReporting';
import { isExpenseNoVatPayment } from './proformaVat';
import {
  LEAD_EMPLOYEE_COST_OF_OPERATING_SHARE,
  LEAD_VALUE_OPERATING_SHARE,
  maxLeadEmployeeCostNis,
  resolveLeadTotalValueNis,
} from './leadEmployeeCost';
import { fetchAverageGrossSalaryLastMonths } from './employeeSalaries';
import { fetchClockInRecordsInRangeForReport } from './workingHoursExport';

export type AllocationBudgetLeadRef = {
  key: string;
  lead_type: LeadReportingType;
  new_lead_id: string | null;
  legacy_lead_id: number | null;
  lead_number: string;
  client_name: string;
  percent: number;
};

export type LeadAllocationBudgetViolation = {
  key: string;
  lead_number: string;
  client_name: string;
  requestedPercent: number;
  requestedAllocatedMs: number;
  maxAllowedPercent: number;
  maxAllocatedMs: number;
  remainingCostNis: number;
  maxAllowedCostNis: number;
  otherCostOnLeadNis: number;
  proposedCostNis: number;
  leadTotalValueNis: number;
};

export type LeadAllocationBudgetHint = {
  key: string;
  maxAllowedPercent: number;
  maxAllocatedMs: number;
  remainingCostNis: number;
  maxAllowedCostNis: number;
  otherCostOnLeadNis: number;
  proposedCostNis: number;
  overBudget: boolean;
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
          min_hours: number | null;
        }
      | {
          id: number;
          min_hours: number | null;
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

async function fetchNewLeadPaymentPlanBaseTotal(leadId: string): Promise<number | null> {
  const { data, error } = await supabase
    .from('payment_plans')
    .select('value, payment_order')
    .eq('lead_id', leadId)
    .is('cancel_date', null);
  if (error) {
    console.warn('[leadAllocationBudget] payment plan fetch failed:', error);
    return null;
  }
  const rows = data || [];
  if (rows.length === 0) return null;

  let baseTotal = 0;
  let hasPlan = false;
  for (const row of rows as Array<{ value?: unknown; payment_order?: unknown }>) {
    const order = row.payment_order;
    if (isExpenseNoVatPayment(order)) continue;
    hasPlan = true;
    const base = Number(row.value ?? 0);
    if (Number.isFinite(base)) baseTotal += base;
  }
  return hasPlan ? baseTotal : null;
}

async function fetchLegacyLeadPaymentPlanBaseTotal(legacyId: number): Promise<number | null> {
  const { data, error } = await supabase
    .from('finances_paymentplanrow')
    .select('value, order')
    .eq('lead_id', legacyId)
    .is('cancel_date', null);
  if (error) {
    console.warn('[leadAllocationBudget] legacy payment plan fetch failed:', error);
    return null;
  }
  const rows = data || [];
  if (rows.length === 0) return null;

  let baseTotal = 0;
  let hasPlan = false;
  for (const row of rows as Array<{ value?: unknown; order?: unknown }>) {
    const order = row.order;
    if (isExpenseNoVatPayment(order)) continue;
    hasPlan = true;
    const base = Number(row.value ?? 0);
    if (Number.isFinite(base)) baseTotal += base;
  }
  return hasPlan ? baseTotal : null;
}

async function fetchLeadTotalValueNisForRef(lead: AllocationBudgetLeadRef): Promise<number> {
  if (lead.lead_type === 'legacy' && lead.legacy_lead_id != null) {
    const [{ data, error }, planBase] = await Promise.all([
      supabase
        .from('leads_lead')
        .select('id, total, total_base, currency_id')
        .eq('id', lead.legacy_lead_id)
        .maybeSingle(),
      fetchLegacyLeadPaymentPlanBaseTotal(lead.legacy_lead_id),
    ]);
    if (error) {
      console.warn('[leadAllocationBudget] legacy lead value fetch failed:', error);
    }
    return resolveLeadTotalValueNis(
      data
        ? { ...data, lead_type: 'legacy', id: `legacy_${data.id}` }
        : { lead_type: 'legacy', id: `legacy_${lead.legacy_lead_id}` },
      {
        hasPaymentPlan: planBase != null,
        paymentPlanBaseTotal: planBase,
      },
    );
  }

  let newLeadId = lead.new_lead_id;
  if (!newLeadId && lead.lead_number) {
    const { data: byNumber } = await supabase
      .from('leads')
      .select('id')
      .eq('lead_number', lead.lead_number)
      .maybeSingle();
    if (byNumber?.id) newLeadId = String(byNumber.id);
  }

  if (newLeadId) {
    const [{ data, error }, planBase] = await Promise.all([
      supabase
        .from('leads')
        .select('id, balance, proposal_total, lead_type')
        .eq('id', newLeadId)
        .maybeSingle(),
      fetchNewLeadPaymentPlanBaseTotal(newLeadId),
    ]);
    if (error) {
      console.warn('[leadAllocationBudget] lead value fetch failed:', error);
    }
    return resolveLeadTotalValueNis(data ?? { id: newLeadId }, {
      hasPaymentPlan: planBase != null,
      paymentPlanBaseTotal: planBase,
    });
  }

  return 0;
}

async function fetchEmployeeHourRateNis(employeeId: number): Promise<{
  hourRateNis: number | null;
  minHours: number;
}> {
  const [{ data: emp }, salaryMap] = await Promise.all([
    supabase
      .from('tenants_employee')
      .select('id, min_hours')
      .eq('id', employeeId)
      .maybeSingle(),
    fetchAverageGrossSalaryLastMonths([employeeId], 6),
  ]);

  const minHours = normalizeEmployeeMinHours(emp?.min_hours);
  const avgSalary = salaryMap.get(employeeId) ?? 0;
  const hourRateNis = salaryToHourlyRateNis(avgSalary > 0 ? avgSalary : null, minHours);
  return { hourRateNis, minHours };
}

/**
 * Existing employee cost on a lead, excluding one employee's work on a given date
 * (so we can evaluate a proposed replacement allocation for that day).
 */
async function fetchOtherCostOnLeadNis(params: {
  lead: AllocationBudgetLeadRef;
  excludeEmployeeId: number;
  excludeWorkDate: string;
}): Promise<number> {
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
          min_hours
        )
      )
    `,
  );

  if (params.lead.lead_type === 'legacy' && params.lead.legacy_lead_id != null) {
    query = query.eq('legacy_lead_id', params.lead.legacy_lead_id);
  } else if (params.lead.new_lead_id) {
    query = query.eq('new_lead_id', params.lead.new_lead_id);
  } else if (params.lead.lead_number) {
    query = query.eq('lead_number', params.lead.lead_number);
  } else {
    return 0;
  }

  const { data, error } = await query;
  if (error) {
    console.error('[leadAllocationBudget] allocation cost fetch failed:', error);
    throw error;
  }

  const items = (data || []) as AllocationItemJoin[];
  if (items.length === 0) return 0;

  const employeeIds = new Set<number>();
  let minDate = '';
  let maxDate = '';

  for (const item of items) {
    const alloc = item.employee_daily_lead_allocations;
    if (!alloc) continue;
    if (
      alloc.employee_id === params.excludeEmployeeId &&
      alloc.work_date === params.excludeWorkDate
    ) {
      continue;
    }
    employeeIds.add(alloc.employee_id);
    if (!minDate || alloc.work_date < minDate) minDate = alloc.work_date;
    if (!maxDate || alloc.work_date > maxDate) maxDate = alloc.work_date;
  }

  if (employeeIds.size === 0 || !minDate || !maxDate) return 0;

  const [salaryMap, clockRecords] = await Promise.all([
    fetchAverageGrossSalaryLastMonths(Array.from(employeeIds), 6),
    fetchClockInRecordsInRangeForReport(minDate, maxDate),
  ]);
  const clockMsByEmpDate = buildClockInMsByEmployeeDate(clockRecords);

  let totalCost = 0;
  for (const item of items) {
    const alloc = item.employee_daily_lead_allocations;
    if (!alloc) continue;
    if (
      alloc.employee_id === params.excludeEmployeeId &&
      alloc.work_date === params.excludeWorkDate
    ) {
      continue;
    }

    const empRaw = alloc.tenants_employee;
    const emp = Array.isArray(empRaw) ? empRaw[0] : empRaw;
    const minHours = normalizeEmployeeMinHours(emp?.min_hours);
    const avgSalary = salaryMap.get(alloc.employee_id) ?? 0;
    const hourRateNis = salaryToHourlyRateNis(avgSalary > 0 ? avgSalary : null, minHours);
    const dayWorkedMs =
      clockMsByEmpDate.get(employeeDateKey(alloc.employee_id, alloc.work_date)) ?? 0;
    const workedMs = allocationPercentToWorkedMs(dayWorkedMs, Number(item.percent) || 0);
    totalCost += workedMsAtHourlyRateToCostNis(workedMs, hourRateNis) ?? 0;
  }

  return Math.round(totalCost * 100) / 100;
}

function maxPercentFromRemainingBudget(params: {
  remainingCostNis: number;
  dayWorkedMs: number;
  hourRateNis: number;
}): { maxAllowedPercent: number; maxAllocatedMs: number } {
  const { remainingCostNis, dayWorkedMs, hourRateNis } = params;
  if (remainingCostNis <= 0.005) {
    return { maxAllowedPercent: 0, maxAllocatedMs: 0 };
  }
  if (!(dayWorkedMs > 0) || !(hourRateNis > 0)) {
    return { maxAllowedPercent: 100, maxAllocatedMs: dayWorkedMs };
  }

  // Derive max time from remaining ₪ first (minute-level), then convert to %.
  // Flooring % first (e.g. 0.4% → 0) incorrectly blocked leftover minutes.
  const maxAllocatedMs = Math.max(
    0,
    Math.min(
      dayWorkedMs,
      Math.floor((remainingCostNis / hourRateNis) * 60 * 60 * 1000),
    ),
  );
  const maxAllowedPercent =
    dayWorkedMs > 0
      ? Math.min(100, Math.round((maxAllocatedMs / dayWorkedMs) * 10000) / 100)
      : 0;

  return { maxAllowedPercent, maxAllocatedMs };
}

/**
 * Evaluates proposed daily allocations against the lead employee-cost cap
 * (14% of 87% of lead value). Returns violations and per-lead budget hints.
 */
export async function evaluateDailyLeadAllocationBudgets(params: {
  employeeId: number;
  workDate: string;
  dayWorkedMs: number;
  leads: AllocationBudgetLeadRef[];
}): Promise<{
  violations: LeadAllocationBudgetViolation[];
  hints: LeadAllocationBudgetHint[];
  hourRateNis: number | null;
}> {
  const included = params.leads.filter((lead) => (Number(lead.percent) || 0) > 0);
  if (included.length === 0) {
    return { violations: [], hints: [], hourRateNis: null };
  }

  const { hourRateNis } = await fetchEmployeeHourRateNis(params.employeeId);
  if (hourRateNis == null || !(params.dayWorkedMs > 0)) {
    return { violations: [], hints: [], hourRateNis };
  }

  const results = await Promise.all(
    included.map(async (lead) => {
      const [leadTotalValueNis, otherCostOnLeadNis] = await Promise.all([
        fetchLeadTotalValueNisForRef(lead),
        fetchOtherCostOnLeadNis({
          lead,
          excludeEmployeeId: params.employeeId,
          excludeWorkDate: params.workDate,
        }),
      ]);

      const maxAllowedCostNis = maxLeadEmployeeCostNis(leadTotalValueNis);
      // Without a reliable lead value, do not block the worker.
      if (!(leadTotalValueNis > 0) || !(maxAllowedCostNis > 0)) {
        return {
          hint: {
            key: lead.key,
            maxAllowedPercent: 100,
            maxAllocatedMs: params.dayWorkedMs,
            remainingCostNis: 0,
            maxAllowedCostNis: 0,
            otherCostOnLeadNis,
            proposedCostNis: 0,
            overBudget: false,
          } satisfies LeadAllocationBudgetHint,
          violation: null,
        };
      }

      const remainingCostNis = Math.max(0, maxAllowedCostNis - otherCostOnLeadNis);
      const proposedWorkedMs = allocationPercentToWorkedMs(
        params.dayWorkedMs,
        Number(lead.percent) || 0,
      );
      const proposedCostNis =
        workedMsAtHourlyRateToCostNis(proposedWorkedMs, hourRateNis) ?? 0;
      const { maxAllowedPercent, maxAllocatedMs } = maxPercentFromRemainingBudget({
        remainingCostNis,
        dayWorkedMs: params.dayWorkedMs,
        hourRateNis,
      });

      const overBudget = proposedCostNis > remainingCostNis + 0.005;

      const hint: LeadAllocationBudgetHint = {
        key: lead.key,
        maxAllowedPercent,
        maxAllocatedMs,
        remainingCostNis: Math.round(remainingCostNis * 100) / 100,
        maxAllowedCostNis,
        otherCostOnLeadNis,
        proposedCostNis: Math.round(proposedCostNis * 100) / 100,
        overBudget,
      };

      const violation: LeadAllocationBudgetViolation | null = overBudget
        ? {
            key: lead.key,
            lead_number: lead.lead_number,
            client_name: lead.client_name,
            requestedPercent: Math.round(Number(lead.percent) || 0),
            requestedAllocatedMs: proposedWorkedMs,
            maxAllowedPercent,
            maxAllocatedMs,
            remainingCostNis: hint.remainingCostNis,
            maxAllowedCostNis,
            otherCostOnLeadNis,
            proposedCostNis: hint.proposedCostNis,
            leadTotalValueNis,
          }
        : null;

      return { hint, violation };
    }),
  );

  return {
    violations: results
      .map((r) => r.violation)
      .filter((v): v is LeadAllocationBudgetViolation => v != null),
    hints: results.map((r) => r.hint),
    hourRateNis,
  };
}

export function formatAllocationBudgetCapRule(): string {
  return `${Math.round(LEAD_EMPLOYEE_COST_OF_OPERATING_SHARE * 100)}% of ${Math.round(LEAD_VALUE_OPERATING_SHARE * 100)}% of lead value`;
}

/** Duration label that still shows leftover time under one minute. */
export function formatBudgetAllocationDuration(ms: number): string {
  const safe = Math.max(0, Math.round(ms));
  if (safe <= 0) return '0m';
  if (safe < 60_000) return `${Math.max(1, Math.round(safe / 1000))}s`;
  return formatAllocationWorkedDuration(safe);
}

export { formatAllocationCostNis, formatAllocationWorkedDuration, maxLeadEmployeeCostNis };
