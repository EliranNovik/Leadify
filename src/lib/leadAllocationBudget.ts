import { supabase } from './supabase';
import {
  allocationPercentToWorkedMs,
  fetchDailyAllocation,
  formatAllocationCostNis,
  formatAllocationWorkedDuration,
  normalizeEmployeeMinHours,
  salaryToHourlyRateNis,
  workedMsAtHourlyRateToCostNis,
  type LeadReportingType,
} from './employeeLeadReporting';
import {
  LEAD_EMPLOYEE_COST_OF_OPERATING_SHARE,
  LEAD_VALUE_OPERATING_SHARE,
  maxLeadEmployeeCostNis,
  resolveLeadTotalValueNis,
  fetchLeadEmployeeCostSummary,
  fetchLeadPaymentPlanBaseTotalNis,
  remainingTimeFromLeadCostSummary,
  type LeadEmployeeCostSummary,
} from './leadEmployeeCost';
import {
  fetchFirmPaidExpenseReductionTotalNis,
  resolveLeadFeeIdentity,
} from './leadExpenses';
import {
  fetchBudgetExtensionRequestsForLeads,
  type LeadBudgetExtensionRequest,
} from './leadBudgetExtensionRequests';
import { fetchAverageGrossSalaryLastMonths } from './employeeSalaries';

export type AllocationBudgetLeadRef = {
  key: string;
  lead_type: LeadReportingType | null;
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
  /** Remaining time on the lead (same basis as Clients bar “Left”). */
  remainingWorkedMs: number | null;
  /** All-time spent on the lead (same as Clients “Spent”). */
  leadWorkedMs: number;
  maxAllowedCostNis: number;
  otherCostOnLeadNis: number;
  proposedCostNis: number;
  overBudget: boolean;
};


function isUuidLeadId(value: string | null | undefined): boolean {
  if (!value) return false;
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    value.trim(),
  );
}

function leadNumberCandidates(leadNumber: string | null | undefined): string[] {
  const raw = String(leadNumber || '').trim();
  if (!raw || raw === '—') return [];
  const base = raw.replace(/\/\d+$/, '');
  return base && base !== raw ? [raw, base] : [raw];
}

async function resolveNewLeadIdFromLeadNumber(
  leadNumber: string | null | undefined,
): Promise<string | null> {
  for (const candidate of leadNumberCandidates(leadNumber)) {
    const { data } = await supabase
      .from('leads')
      .select('id')
      .eq('lead_number', candidate)
      .maybeSingle();
    if (data?.id) return String(data.id);
  }
  return null;
}

async function fetchLeadTotalValueNisForRef(lead: AllocationBudgetLeadRef): Promise<number> {
  if (lead.lead_type === 'legacy' && lead.legacy_lead_id != null) {
    const identity = resolveLeadFeeIdentity({
      id: `legacy_${lead.legacy_lead_id}`,
      lead_type: 'legacy',
      lead_number: lead.lead_number,
    });
    const clientStub = {
      id: `legacy_${lead.legacy_lead_id}`,
      lead_type: 'legacy' as const,
    };
    const [{ data, error }, planBaseNis, firmPaidExpenseTotalNis] = await Promise.all([
      supabase
        .from('leads_lead')
        .select('id, total, total_base, currency_id, subcontractor_fee')
        .eq('id', lead.legacy_lead_id)
        .maybeSingle(),
      fetchLeadPaymentPlanBaseTotalNis(clientStub),
      identity ? fetchFirmPaidExpenseReductionTotalNis(identity) : Promise.resolve(0),
    ]);
    if (error) {
      console.warn('[leadAllocationBudget] legacy lead value fetch failed:', error);
    }
    return resolveLeadTotalValueNis(
      data
        ? { ...data, lead_type: 'legacy', id: `legacy_${data.id}` }
        : { lead_type: 'legacy', id: `legacy_${lead.legacy_lead_id}` },
      {
        hasPaymentPlan: planBaseNis != null,
        paymentPlanBaseTotal: planBaseNis,
        paymentPlanBaseTotalIsNis: true,
        firmPaidExpenseTotalNis,
      },
    );
  }

  let newLeadId = lead.new_lead_id && isUuidLeadId(lead.new_lead_id) ? lead.new_lead_id : null;
  if (!newLeadId) {
    newLeadId = await resolveNewLeadIdFromLeadNumber(lead.lead_number);
  }

  if (newLeadId) {
    const identity = resolveLeadFeeIdentity({
      id: newLeadId,
      lead_type: 'new',
      lead_number: lead.lead_number,
    });
    // `leads` has no lead_type column — selecting it fails the whole value fetch
    // and zeros the budget max (false "0m left / max 0%" on daily allocation).
    const clientStub = { id: newLeadId, lead_type: 'new' as const };
    const [{ data, error }, planBaseNis, firmPaidExpenseTotalNis] = await Promise.all([
      supabase
        .from('leads')
        .select(
          'id, balance, proposal_total, currency_id, subcontractor_fee, case_handler_id, retainer_handler_id, lead_number',
        )
        .eq('id', newLeadId)
        .maybeSingle(),
      fetchLeadPaymentPlanBaseTotalNis(clientStub),
      identity ? fetchFirmPaidExpenseReductionTotalNis(identity) : Promise.resolve(0),
    ]);
    if (error) {
      console.warn('[leadAllocationBudget] lead value fetch failed:', error);
    }
    return resolveLeadTotalValueNis(
      data
        ? { ...data, lead_type: 'new', id: newLeadId }
        : { id: newLeadId, lead_type: 'new', lead_number: lead.lead_number },
      {
        hasPaymentPlan: planBaseNis != null,
        paymentPlanBaseTotal: planBaseNis,
        paymentPlanBaseTotalIsNis: true,
        firmPaidExpenseTotalNis,
      },
    );
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
 * Cost already booked for this employee+date on the lead (saved allocation),
 * so we can treat a new daily % as a replacement for that day.
 * Uses the same fetch path as the reporting page (allocation header + items).
 */
async function fetchEmployeeDayCostOnLeadNis(params: {
  lead: AllocationBudgetLeadRef;
  employeeId: number;
  workDate: string;
  dayWorkedMs: number;
  hourRateNis: number;
}): Promise<number> {
  const allocation = await fetchDailyAllocation(params.employeeId, params.workDate);
  if (!allocation?.items?.length) return 0;

  const lead = params.lead;
  const item = allocation.items.find((row) => {
    if (
      lead.new_lead_id &&
      row.new_lead_id &&
      String(row.new_lead_id) === String(lead.new_lead_id)
    ) {
      return true;
    }
    if (
      lead.legacy_lead_id != null &&
      row.legacy_lead_id != null &&
      Number(row.legacy_lead_id) === Number(lead.legacy_lead_id)
    ) {
      return true;
    }
    if (lead.lead_number && row.lead_number && String(row.lead_number) === String(lead.lead_number)) {
      return true;
    }
    return false;
  });
  if (!item) return 0;

  const workedMs = allocationPercentToWorkedMs(params.dayWorkedMs, Number(item.percent) || 0);
  return workedMsAtHourlyRateToCostNis(workedMs, params.hourRateNis) ?? 0;
}

async function resolveBudgetLeadClient(lead: AllocationBudgetLeadRef): Promise<{
  client: Record<string, unknown>;
  leadTotalValueNis: number;
  resolved: AllocationBudgetLeadRef;
}> {
  const isLegacy = lead.lead_type === 'legacy' || lead.legacy_lead_id != null;
  let newLeadId =
    !isLegacy && lead.new_lead_id && isUuidLeadId(lead.new_lead_id) ? lead.new_lead_id : null;
  if (!isLegacy && !newLeadId) {
    newLeadId = await resolveNewLeadIdFromLeadNumber(lead.lead_number);
  }

  const resolved: AllocationBudgetLeadRef = {
    ...lead,
    lead_type: isLegacy ? 'legacy' : 'new',
    new_lead_id: isLegacy ? null : newLeadId,
    legacy_lead_id: isLegacy ? lead.legacy_lead_id : null,
  };

  const leadTotalValueNis = await fetchLeadTotalValueNisForRef(resolved);

  // Prefer a full lead row (handlers + balance) so cost summary matches Clients.
  if (!isLegacy && newLeadId) {
    const { data } = await supabase
      .from('leads')
      .select(
        'id, balance, proposal_total, subcontractor_fee, case_handler_id, retainer_handler_id, lead_number',
      )
      .eq('id', newLeadId)
      .maybeSingle();
    if (data) {
      return {
        client: {
          ...data,
          lead_type: 'new',
          lead_number: data.lead_number || lead.lead_number,
        },
        leadTotalValueNis,
        resolved,
      };
    }
  }

  const client = isLegacy
    ? {
        id: `legacy_${lead.legacy_lead_id}`,
        lead_type: 'legacy' as const,
        lead_number: lead.lead_number,
      }
    : {
        id: newLeadId || null,
        lead_type: 'new' as const,
        lead_number: lead.lead_number,
      };

  return { client, leadTotalValueNis, resolved };
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

  // Same remaining-time basis as Clients (round to ms), then clamp to the day.
  const rawMs = (remainingCostNis / hourRateNis) * 60 * 60 * 1000;
  const maxAllocatedMs = Math.max(
    0,
    Math.min(dayWorkedMs, Math.max(0, Math.round(rawMs))),
  );
  const maxAllowedPercent =
    dayWorkedMs > 0
      ? Math.min(100, Math.round((maxAllocatedMs / dayWorkedMs) * 10000) / 100)
      : 0;

  return { maxAllowedPercent, maxAllocatedMs };
}

/**
 * Evaluates proposed daily allocations against the lead employee-cost cap.
 * Uses {@link fetchLeadEmployeeCostSummary} — same max / spent / left as Clients.
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
      const { client, leadTotalValueNis, resolved } = await resolveBudgetLeadClient(lead);

      const [summary, todayCostOnLeadNis] = await Promise.all([
        fetchLeadEmployeeCostSummary({
          client,
          leadTotalValueNis,
        }),
        fetchEmployeeDayCostOnLeadNis({
          lead: resolved,
          employeeId: params.employeeId,
          workDate: params.workDate,
          dayWorkedMs: params.dayWorkedMs,
          hourRateNis,
        }),
      ]);

      const maxAllowedCostNis = summary.maxAllowedCostNis;
      // Exact Clients bar leftover (Spent / Left / Max total).
      const clientsRemaining = remainingTimeFromLeadCostSummary(summary);
      // Today's proposal replaces any saved % for this date — add that day back so
      // leftover on the Clients bar stays allocatable today.
      const remainingCostNis =
        Math.round((clientsRemaining.remainingCostNis + todayCostOnLeadNis) * 100) / 100;
      const otherCostOnLeadNis = Math.max(
        0,
        Math.round((summary.totalCostNis - todayCostOnLeadNis) * 100) / 100,
      );

      // Without a reliable lead value / max, only block when Clients would also
      // treat spent time on a 0-max lead as over budget.
      if (!(maxAllowedCostNis > 0)) {
        const spentWithNoMax =
          summary.totalCostNis > 0.005 || summary.totalWorkedMs > 0;
        if (!spentWithNoMax) {
          return {
            hint: {
              key: lead.key,
              maxAllowedPercent: 100,
              maxAllocatedMs: params.dayWorkedMs,
              remainingCostNis: 0,
              remainingWorkedMs: null,
              leadWorkedMs: summary.totalWorkedMs,
              maxAllowedCostNis: 0,
              otherCostOnLeadNis,
              proposedCostNis: 0,
              overBudget: false,
            } satisfies LeadAllocationBudgetHint,
            violation: null,
          };
        }
        // Max is 0 but time was already spent — same as Clients exceedsCap.
        const proposedWorkedMs = allocationPercentToWorkedMs(
          params.dayWorkedMs,
          Number(lead.percent) || 0,
        );
        const proposedCostNis =
          workedMsAtHourlyRateToCostNis(proposedWorkedMs, hourRateNis) ?? 0;
        const overBudget = proposedCostNis > 0.005;
        const hint: LeadAllocationBudgetHint = {
          key: lead.key,
          maxAllowedPercent: 0,
          maxAllocatedMs: 0,
          remainingCostNis: 0,
          remainingWorkedMs: 0,
          leadWorkedMs: summary.totalWorkedMs,
          maxAllowedCostNis: 0,
          otherCostOnLeadNis,
          proposedCostNis: Math.round(proposedCostNis * 100) / 100,
          overBudget,
        };
        return {
          hint,
          violation: overBudget
            ? {
                key: lead.key,
                lead_number: lead.lead_number,
                client_name: lead.client_name,
                requestedPercent: Math.round(Number(lead.percent) || 0),
                requestedAllocatedMs: proposedWorkedMs,
                maxAllowedPercent: 0,
                maxAllocatedMs: 0,
                remainingCostNis: 0,
                maxAllowedCostNis: 0,
                otherCostOnLeadNis,
                proposedCostNis: hint.proposedCostNis,
                leadTotalValueNis,
              }
            : null,
        };
      }

      // "Left on lead" must match Clients exactly (not today's adjusted budget).
      const remainingWorkedMs = clientsRemaining.remainingWorkedMs;
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
        remainingWorkedMs,
        leadWorkedMs: summary.totalWorkedMs,
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

export type AllocationLeadBudgetStatus = {
  key: string;
  costNis: number;
  workedMs: number;
  maxAllowedCostNis: number;
  baseMaxAllowedCostNis: number;
  approvedExtensionCostNis: number;
  utilizationPercent: number;
  exceedsCap: boolean;
  /** Same summary shape as Clients / ClientHeader budget bar */
  costSummary: LeadEmployeeCostSummary;
  budgetRequests: LeadBudgetExtensionRequest[];
  pendingRequestCount: number;
  requestCount: number;
};

export function allocationLeadBudgetKey(lead: {
  is_other_work?: boolean;
  lead_type: LeadReportingType | null;
  new_lead_id: string | null;
  legacy_lead_id: number | null;
  lead_number: string;
}): string | null {
  if (lead.is_other_work) return null;
  if (lead.lead_type === 'legacy' && lead.legacy_lead_id != null) {
    return `legacy:${lead.legacy_lead_id}`;
  }
  if (lead.new_lead_id) return `new:${lead.new_lead_id}`;
  if (lead.lead_number && lead.lead_number !== '—') return `number:${lead.lead_number}`;
  return null;
}

/**
 * All-time lead budget status for allocation-report rows — same max as clients
 * (formula + approved extensions / override) and leads management.
 */
export async function fetchAllocationLeadBudgetStatuses(
  leads: Array<{
    is_other_work?: boolean;
    lead_type: LeadReportingType | null;
    new_lead_id: string | null;
    legacy_lead_id: number | null;
    lead_number: string;
    client_name?: string;
  }>,
): Promise<Map<string, AllocationLeadBudgetStatus>> {
  const byKey = new Map<string, AllocationLeadBudgetStatus>();
  const unique = new Map<
    string,
    {
      lead_type: LeadReportingType | null;
      new_lead_id: string | null;
      legacy_lead_id: number | null;
      lead_number: string;
      client_name: string;
    }
  >();

  for (const lead of leads) {
    const key = allocationLeadBudgetKey(lead);
    if (!key || unique.has(key)) continue;
    unique.set(key, {
      lead_type: lead.lead_type,
      new_lead_id: lead.new_lead_id,
      legacy_lead_id: lead.legacy_lead_id,
      lead_number: lead.lead_number,
      client_name: lead.client_name || '',
    });
  }

  if (unique.size === 0) return byKey;

  const refs = Array.from(unique.entries()).map(([key, lead]) => ({
    key,
    leadType: lead.lead_type,
    newLeadId: lead.new_lead_id,
    legacyLeadId: lead.legacy_lead_id,
    leadNumber: lead.lead_number,
  }));

  const requestsByKey = await fetchBudgetExtensionRequestsForLeads(refs);

  const results = await Promise.all(
    Array.from(unique.entries()).map(async ([key, lead]) => {
      const isLegacy = lead.lead_type === 'legacy' || lead.legacy_lead_id != null;
      let newLeadId = lead.new_lead_id;
      if (!isLegacy && !newLeadId && lead.lead_number && lead.lead_number !== '—') {
        const { data: byNumber } = await supabase
          .from('leads')
          .select('id')
          .eq('lead_number', lead.lead_number)
          .maybeSingle();
        if (byNumber?.id) newLeadId = String(byNumber.id);
      }

      const budgetRef: AllocationBudgetLeadRef = {
        key,
        lead_type: isLegacy ? 'legacy' : 'new',
        new_lead_id: isLegacy ? null : newLeadId,
        legacy_lead_id: isLegacy ? lead.legacy_lead_id : null,
        lead_number: lead.lead_number,
        client_name: lead.client_name,
        percent: 0,
      };

      const leadTotalValueNis = await fetchLeadTotalValueNisForRef(budgetRef);
      const client = isLegacy
        ? {
            id: `legacy_${lead.legacy_lead_id}`,
            lead_type: 'legacy' as const,
            lead_number: lead.lead_number,
          }
        : {
            id: newLeadId || null,
            lead_type: 'new' as const,
            lead_number: lead.lead_number,
          };

      const summary = await fetchLeadEmployeeCostSummary({
        client,
        leadTotalValueNis,
      });

      const budgetRequests =
        requestsByKey.get(key) ||
        (newLeadId ? requestsByKey.get(`new:${newLeadId}`) : undefined) ||
        (lead.legacy_lead_id != null
          ? requestsByKey.get(`legacy:${lead.legacy_lead_id}`)
          : undefined) ||
        requestsByKey.get(`number:${lead.lead_number}`) ||
        [];

      const status: AllocationLeadBudgetStatus = {
        key,
        costNis: summary.totalCostNis,
        workedMs: summary.totalWorkedMs,
        maxAllowedCostNis: summary.maxAllowedCostNis,
        baseMaxAllowedCostNis: summary.baseMaxAllowedCostNis,
        approvedExtensionCostNis: summary.approvedExtensionCostNis,
        utilizationPercent: summary.utilizationPercent,
        exceedsCap: summary.exceedsCap,
        costSummary: summary,
        budgetRequests,
        pendingRequestCount: budgetRequests.filter((r) => r.status === 'pending').length,
        requestCount: budgetRequests.length,
      };
      return status;
    }),
  );

  for (const status of results) {
    byKey.set(status.key, status);
  }
  return byKey;
}

/** Duration label that still shows leftover time under one minute. */
export function formatBudgetAllocationDuration(ms: number): string {
  const safe = Math.max(0, Math.round(ms));
  if (safe <= 0) return '0m';
  if (safe < 60_000) return `${Math.max(1, Math.round(safe / 1000))}s`;
  return formatAllocationWorkedDuration(safe);
}

export { formatAllocationCostNis, formatAllocationWorkedDuration, maxLeadEmployeeCostNis };
