import { supabase } from './supabase';
import {
  allocationEmployeeDateKey,
  allocationPercentToWorkedMs,
  buildAllocationClockInMsByEmployeeDate,
  buildClientRouteFromAllocationRow,
  formatAllocationCostNis,
  formatAllocationWorkedDuration,
  getJerusalemTodayIsoDate,
  normalizeEmployeeMinHours,
  LEAD_ALLOCATION_MIN_STAGE_ID,
  salaryToHourlyRateNis,
  workedMsAtHourlyRateToCostNis,
  type LeadReportingType,
} from './employeeLeadReporting';
import {
  maxLeadEmployeeCostNis,
  resolveLeadTotalValueNis,
  fetchLeadPaymentPlanBaseTotalNis,
} from './leadEmployeeCost';
import { isExpenseNoVatPayment } from './proformaVat';
import { convertToNIS, ensureBoiRatesReady } from './boiCurrencyConversion';
import {
  fetchFirmPaidExpenseReductionTotalNis,
  leadExpenseReductionAmount,
  resolveLeadFeeIdentity,
} from './leadExpenses';
import { fetchAverageGrossSalaryLastMonths } from './employeeSalaries';
import { fetchClockInRecordsForAllocationMs } from './workingHoursExport';
import {
  fetchBudgetExtensionRequestsForLeads,
  type LeadBudgetExtensionRequest,
} from './leadBudgetExtensionRequests';
import {
  fetchLeadCostMaxOverridesForLeads,
  leadOverrideStorageKey,
  resolveEffectiveMaxAllowedCostNis,
} from './leadEmployeeCostMaxOverride';

export type LeadManagementEmployeeSlice = {
  employeeId: number;
  employeeName: string;
  photoUrl: string | null;
  departmentName: string | null;
  workedMs: number;
  costNis: number;
  /** Derived from avg salary ÷ 127 monthly hours. Null when the employee has no salary on file. */
  hourRateNis: number | null;
  /** Reported time, but no positive salary in the last 6 months. */
  missingSalary: boolean;
  /** Latest allocation date for this employee on the lead, YYYY-MM-DD. */
  lastWorkDate: string | null;
};

export type LeadManagementLeadRow = {
  key: string;
  leadType: LeadReportingType | null;
  newLeadId: string | null;
  legacyLeadId: number | null;
  leadNumber: string;
  clientName: string;
  /** Linked contact names (for search) */
  contactNames: string[];
  /** Display: "Main / Sub" */
  category: string | null;
  mainCategory: string | null;
  subcategory: string | null;
  workedMs: number;
  costNis: number;
  maxAllowedCostNis: number;
  baseMaxAllowedCostNis: number;
  approvedExtensionCostNis: number;
  /** Absolute management override; when set, replaces formula + extensions. */
  maxOverrideNis: number | null;
  leadTotalValueNis: number;
  /** True when the lead has a non-cancelled payment plan (blocks value edit here). */
  hasPaymentPlan: boolean;
  utilizationPercent: number;
  exceedsCap: boolean;
  /** Handler Nominated (105) or later, and the lead balance / legacy total is empty or zero. */
  missingBalance: boolean;
  stageId: number | null;
  employees: LeadManagementEmployeeSlice[];
  /** One entry per employee per reported day, so the page can filter From / To without refetching. */
  daySlices: LeadManagementDaySlice[];
  budgetRequests: LeadBudgetExtensionRequest[];
  pendingRequestCount: number;
  requestCount: number;
};

export type LeadManagementDaySlice = {
  workDate: string;
  employeeId: number;
  employeeName: string;
  photoUrl: string | null;
  departmentName: string | null;
  workedMs: number;
  costNis: number;
  hourRateNis: number | null;
};

export type LeadManagementDayBreakdown = {
  workDate: string;
  workedMs: number;
  costNis: number;
  employees: LeadManagementEmployeeSlice[];
};

export type LeadManagementDetail = {
  lead: LeadManagementLeadRow;
  days: LeadManagementDayBreakdown[];
};

type AllocItemJoin = {
  id: number;
  percent: number;
  lead_number: string | null;
  lead_type: string | null;
  new_lead_id: string | null;
  legacy_lead_id: number | null;
  client_name: string | null;
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

function leadKeyFromItem(item: {
  lead_type: string | null;
  new_lead_id: string | null;
  legacy_lead_id: number | null;
  lead_number: string | null;
}): string | null {
  if (item.lead_type === 'legacy' && item.legacy_lead_id != null) {
    return `legacy:${item.legacy_lead_id}`;
  }
  if (item.new_lead_id) return `new:${item.new_lead_id}`;
  const num = String(item.lead_number || '').trim();
  if (num && num !== '—') return `number:${num}`;
  return null;
}

function positiveMoney(value: unknown): number | null {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : null;
}

function stageIdFrom(value: unknown): number | null {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

/** Handling stages with nothing stored as the lead's balance (legacy: total). */
function missingHandlingBalance(stageId: number | null, balanceAmount: number | null): boolean {
  return stageId != null && stageId >= LEAD_ALLOCATION_MIN_STAGE_ID && balanceAmount == null;
}

async function fetchLeadMeta(params: {
  leadType: LeadReportingType | null;
  newLeadId: string | null;
  legacyLeadId: number | null;
  leadNumber: string;
}): Promise<{
  category: string | null;
  mainCategory: string | null;
  subcategory: string | null;
  leadTotalValueNis: number;
  clientName: string | null;
  hasPaymentPlan: boolean;
  stageId: number | null;
  /** Positive balance (new leads) or total (legacy). Null when nothing is on the lead. */
  balanceAmount: number | null;
}> {
  if (params.leadType === 'legacy' && params.legacyLeadId != null) {
    const identity = resolveLeadFeeIdentity({
      id: `legacy_${params.legacyLeadId}`,
      lead_type: 'legacy',
      lead_number: params.leadNumber,
    });
    const clientStub = {
      id: `legacy_${params.legacyLeadId}`,
      lead_type: 'legacy' as const,
    };
    const [{ data }, planBaseNis, firmPaidExpenseTotalNis] = await Promise.all([
      supabase
        .from('leads_lead')
        .select(
          `
          id, name, category, category_id, stage, total, total_base, currency_id, manual_id, subcontractor_fee,
          misc_category!leads_lead_category_id_fkey (
            id, name, parent_id,
            misc_maincategory!parent_id ( id, name )
          )
        `,
        )
        .eq('id', params.legacyLeadId)
        .maybeSingle(),
      fetchLeadPaymentPlanBaseTotalNis(clientStub),
      identity ? fetchFirmPaidExpenseReductionTotalNis(identity) : Promise.resolve(0),
    ]);
    const leadTotalValueNis = await resolveLeadTotalValueNis(
      data
        ? { ...data, lead_type: 'legacy', id: `legacy_${data.id}` }
        : { lead_type: 'legacy', id: `legacy_${params.legacyLeadId}` },
      {
        hasPaymentPlan: planBaseNis != null,
        paymentPlanBaseTotal: planBaseNis,
        paymentPlanBaseTotalIsNis: true,
        firmPaidExpenseTotalNis,
      },
    );
    const cats = formatLeadCategoryParts(data);
    const balanceAmount = positiveMoney(data?.total_base) ?? positiveMoney(data?.total);
    const stageId = stageIdFrom(data?.stage);
    return {
      ...cats,
      leadTotalValueNis,
      clientName: data?.name != null ? String(data.name).trim() || null : null,
      hasPaymentPlan: planBaseNis != null,
      stageId,
      balanceAmount,
    };
  }

  let newLeadId = params.newLeadId;
  if (!newLeadId && params.leadNumber) {
    const { data: byNumber } = await supabase
      .from('leads')
      .select('id')
      .eq('lead_number', params.leadNumber)
      .maybeSingle();
    if (byNumber?.id) newLeadId = String(byNumber.id);
  }

  if (newLeadId) {
    const identity = resolveLeadFeeIdentity({
      id: newLeadId,
      lead_type: 'new',
      lead_number: params.leadNumber,
    });
    const clientStub = { id: newLeadId, lead_type: 'new' as const };
    const [{ data }, planBaseNis, firmPaidExpenseTotalNis] = await Promise.all([
      supabase
        .from('leads')
        .select(
          `
          id, name, category, category_id, stage, balance, proposal_total, currency_id, lead_number, subcontractor_fee,
          misc_category!category_id (
            id, name, parent_id,
            misc_maincategory!parent_id ( id, name )
          )
        `,
        )
        .eq('id', newLeadId)
        .maybeSingle(),
      fetchLeadPaymentPlanBaseTotalNis(clientStub),
      identity ? fetchFirmPaidExpenseReductionTotalNis(identity) : Promise.resolve(0),
    ]);
    const leadTotalValueNis = await resolveLeadTotalValueNis(data ?? { id: newLeadId }, {
      hasPaymentPlan: planBaseNis != null,
      paymentPlanBaseTotal: planBaseNis,
      paymentPlanBaseTotalIsNis: true,
      firmPaidExpenseTotalNis,
    });
    const cats = formatLeadCategoryParts(data);
    const balanceAmount = positiveMoney(data?.balance);
    const stageId = stageIdFrom(data?.stage);
    return {
      ...cats,
      leadTotalValueNis,
      clientName: data?.name != null ? String(data.name).trim() || null : null,
      hasPaymentPlan: planBaseNis != null,
      stageId,
      balanceAmount,
    };
  }

  return {
    category: null,
    mainCategory: null,
    subcategory: null,
    leadTotalValueNis: 0,
    clientName: null,
    hasPaymentPlan: false,
    stageId: null,
    balanceAmount: null,
  };
}

type LeadMeta = Awaited<ReturnType<typeof fetchLeadMeta>>;

const EMPTY_LEAD_META: LeadMeta = {
  category: null,
  mainCategory: null,
  subcategory: null,
  leadTotalValueNis: 0,
  clientName: null,
  hasPaymentPlan: false,
  stageId: null,
  balanceAmount: null,
};

async function selectInChunks<T>(
  run: (chunk: Array<string | number>) => Promise<{ data: T[] | null; error: { message?: string } | null }>,
  ids: Array<string | number>,
): Promise<T[]> {
  const rows: T[] = [];
  for (let index = 0; index < ids.length; index += LEAD_LOOKUP_CHUNK) {
    const chunk = ids.slice(index, index + LEAD_LOOKUP_CHUNK);
    if (chunk.length === 0) continue;
    const { data, error } = await run(chunk);
    if (error) throw error;
    rows.push(...(data || []));
  }
  return rows;
}

function paymentPlanTotalNis(
  rows: Array<{
    id?: unknown;
    value?: unknown;
    payment_order?: unknown;
    order?: unknown;
    currency_id?: number | string | null;
    currency?: string | null;
  }>,
  snapshot: Awaited<ReturnType<typeof ensureBoiRatesReady>>,
  legacy: boolean,
): number | null {
  const seen = new Set<string>();
  let baseTotalNis = 0;
  let hasContract = false;
  for (const row of rows) {
    const key = row.id != null ? String(row.id) : JSON.stringify(row);
    if (seen.has(key)) continue;
    seen.add(key);
    const order = legacy ? row.order : row.payment_order;
    if (isExpenseNoVatPayment(order as string | number | null | undefined)) continue;
    hasContract = true;
    const base = Number(row.value ?? 0);
    if (!Number.isFinite(base) || !(base > 0)) continue;
    const currency = legacy
      ? row.currency_id ?? 1
      : row.currency_id != null && row.currency_id !== ''
        ? row.currency_id
        : row.currency ?? 1;
    baseTotalNis += convertToNIS(base, currency, snapshot);
  }
  return hasContract ? Math.round(baseTotalNis * 100) / 100 : null;
}

/** One round of queries for every lead, instead of a request per lead. */
async function fetchLeadMetaBatch(
  leads: Array<{
    key: string;
    leadType: LeadReportingType | null;
    newLeadId: string | null;
    legacyLeadId: number | null;
    leadNumber: string;
  }>,
): Promise<Map<string, LeadMeta>> {
  const newIds = [...new Set(leads.map((lead) => lead.newLeadId).filter((id): id is string => Boolean(id)))];
  const legacyIds = [
    ...new Set(
      leads
        .filter((lead) => lead.leadType === 'legacy' && lead.legacyLeadId != null)
        .map((lead) => lead.legacyLeadId as number),
    ),
  ];

  const newSelect = `
    id, name, category, category_id, stage, balance, proposal_total, currency_id, lead_number, subcontractor_fee,
    misc_category!category_id (
      id, name, parent_id,
      misc_maincategory!parent_id ( id, name )
    )
  `;
  const legacySelect = `
    id, name, category, category_id, stage, total, total_base, currency_id, manual_id, subcontractor_fee,
    misc_category!leads_lead_category_id_fkey (
      id, name, parent_id,
      misc_maincategory!parent_id ( id, name )
    )
  `;

  const [newLeads, legacyLeads, newPlansByLead, newPlansByLeadIds, legacyPlans, newExpenses, legacyExpenses] =
    await Promise.all([
      selectInChunks(
        (chunk) => supabase.from('leads').select(newSelect).in('id', chunk as string[]),
        newIds,
      ),
      selectInChunks(
        (chunk) => supabase.from('leads_lead').select(legacySelect).in('id', chunk as number[]),
        legacyIds,
      ),
      selectInChunks(
        (chunk) =>
          supabase
            .from('payment_plans')
            .select('id, lead_id, value, payment_order, currency_id, currency')
            .in('lead_id', chunk as string[])
            .is('cancel_date', null),
        newIds,
      ),
      selectInChunks(
        (chunk) =>
          supabase
            .from('payment_plans')
            .select('id, lead_ids, value, payment_order, currency_id, currency')
            .in('lead_ids', chunk as string[])
            .is('cancel_date', null),
        newIds,
      ).catch((error) => {
        console.error('[leadsManagementReport] payment plan lead_ids lookup failed:', error);
        return [] as Array<Record<string, unknown>>;
      }),
      selectInChunks(
        (chunk) =>
          supabase
            .from('finances_paymentplanrow')
            .select('id, lead_id, value, order, currency_id')
            .in('lead_id', chunk as number[])
            .is('cancel_date', null),
        legacyIds,
      ),
      selectInChunks(
        (chunk) =>
          supabase
            .from('lead_expenses')
            .select('new_lead_id, amount, include_vat, expense_date, paid_by, currency_id')
            .eq('paid_by', 'firm')
            .in('new_lead_id', chunk as string[]),
        newIds,
      ),
      selectInChunks(
        (chunk) =>
          supabase
            .from('lead_expenses')
            .select('legacy_lead_id, amount, include_vat, expense_date, paid_by, currency_id')
            .eq('paid_by', 'firm')
            .in('legacy_lead_id', chunk as number[]),
        legacyIds,
      ),
    ]);

  const snapshot = await ensureBoiRatesReady();
  const newById = new Map(newLeads.map((row) => [String((row as { id: string }).id), row]));
  const legacyById = new Map(legacyLeads.map((row) => [Number((row as { id: number }).id), row]));

  const plansForNew = new Map<string, Array<Record<string, unknown>>>();
  for (const row of [...newPlansByLead, ...newPlansByLeadIds] as Array<Record<string, unknown>>) {
    const leadId = String(row.lead_id || row.lead_ids || '');
    if (!leadId) continue;
    const list = plansForNew.get(leadId) || [];
    list.push(row);
    plansForNew.set(leadId, list);
  }
  const plansForLegacy = new Map<number, Array<Record<string, unknown>>>();
  for (const row of legacyPlans as Array<Record<string, unknown>>) {
    const leadId = Number(row.lead_id);
    if (!Number.isFinite(leadId)) continue;
    const list = plansForLegacy.get(leadId) || [];
    list.push(row);
    plansForLegacy.set(leadId, list);
  }

  const expenseNis = (rows: Array<Record<string, unknown>>) => {
    let sum = 0;
    for (const row of rows) {
      const amount = leadExpenseReductionAmount(row as never);
      if (!(amount > 0)) continue;
      const currencyId = row.currency_id != null ? Number(row.currency_id) : 1;
      sum += convertToNIS(amount, currencyId > 0 ? currencyId : 1, snapshot);
    }
    return Math.round(sum * 100) / 100;
  };
  const expensesForNew = new Map<string, Array<Record<string, unknown>>>();
  for (const row of newExpenses as Array<Record<string, unknown>>) {
    const leadId = String(row.new_lead_id || '');
    if (!leadId) continue;
    const list = expensesForNew.get(leadId) || [];
    list.push(row);
    expensesForNew.set(leadId, list);
  }
  const expensesForLegacy = new Map<number, Array<Record<string, unknown>>>();
  for (const row of legacyExpenses as Array<Record<string, unknown>>) {
    const leadId = Number(row.legacy_lead_id);
    if (!Number.isFinite(leadId)) continue;
    const list = expensesForLegacy.get(leadId) || [];
    list.push(row);
    expensesForLegacy.set(leadId, list);
  }

  const metas = new Map<string, LeadMeta>();
  await Promise.all(
    leads.map(async (lead) => {
      if (lead.leadType === 'legacy' && lead.legacyLeadId != null) {
        const data = legacyById.get(lead.legacyLeadId) as Record<string, unknown> | undefined;
        const planBaseNis = paymentPlanTotalNis(plansForLegacy.get(lead.legacyLeadId) || [], snapshot, true);
        const firmPaid = expenseNis(expensesForLegacy.get(lead.legacyLeadId) || []);
        const leadTotalValueNis = await resolveLeadTotalValueNis(
          data
            ? { ...data, lead_type: 'legacy', id: `legacy_${data.id}` }
            : { lead_type: 'legacy', id: `legacy_${lead.legacyLeadId}` },
          {
            hasPaymentPlan: planBaseNis != null,
            paymentPlanBaseTotal: planBaseNis,
            paymentPlanBaseTotalIsNis: true,
            firmPaidExpenseTotalNis: firmPaid,
          },
        );
        const cats = formatLeadCategoryParts(data as never);
        metas.set(lead.key, {
          ...cats,
          leadTotalValueNis,
          clientName: data?.name != null ? String(data.name).trim() || null : null,
          hasPaymentPlan: planBaseNis != null,
          stageId: stageIdFrom(data?.stage),
          balanceAmount: positiveMoney(data?.total_base) ?? positiveMoney(data?.total),
        });
        return;
      }
      if (!lead.newLeadId) {
        metas.set(lead.key, EMPTY_LEAD_META);
        return;
      }
      const data = newById.get(lead.newLeadId) as Record<string, unknown> | undefined;
      const planBaseNis = paymentPlanTotalNis(plansForNew.get(lead.newLeadId) || [], snapshot, false);
      const firmPaid = expenseNis(expensesForNew.get(lead.newLeadId) || []);
      const leadTotalValueNis = await resolveLeadTotalValueNis(data ?? { id: lead.newLeadId }, {
        hasPaymentPlan: planBaseNis != null,
        paymentPlanBaseTotal: planBaseNis,
        paymentPlanBaseTotalIsNis: true,
        firmPaidExpenseTotalNis: firmPaid,
      });
      const cats = formatLeadCategoryParts(data as never);
      metas.set(lead.key, {
        ...cats,
        leadTotalValueNis,
        clientName: data?.name != null ? String(data.name).trim() || null : null,
        hasPaymentPlan: planBaseNis != null,
        stageId: stageIdFrom(data?.stage),
        balanceAmount: positiveMoney(data?.balance),
      });
    }),
  );
  return metas;
}

function formatLeadCategoryParts(row: {
  category?: unknown;
  misc_category?:
    | {
        name?: string | null;
        misc_maincategory?:
          | { name?: string | null }
          | { name?: string | null }[]
          | null;
      }
    | {
        name?: string | null;
        misc_maincategory?:
          | { name?: string | null }
          | { name?: string | null }[]
          | null;
      }[]
    | null;
} | null): { category: string | null; mainCategory: string | null; subcategory: string | null } {
  if (!row) return { category: null, mainCategory: null, subcategory: null };
  const categoryJoin = Array.isArray(row.misc_category) ? row.misc_category[0] : row.misc_category;
  if (categoryJoin?.name) {
    const mainRel = categoryJoin.misc_maincategory;
    const mainName = Array.isArray(mainRel) ? mainRel[0]?.name : mainRel?.name;
    const subcategory = String(categoryJoin.name).trim() || null;
    const mainCategory = mainName ? String(mainName).trim() || null : null;
    const category =
      mainCategory && subcategory
        ? `${mainCategory} / ${subcategory}`
        : subcategory || mainCategory;
    return { category, mainCategory, subcategory };
  }
  const fallback = row.category != null ? String(row.category).trim() : '';
  return {
    category: fallback || null,
    mainCategory: fallback || null,
    subcategory: null,
  };
}

function utilizationPercent(costNis: number, maxAllowedCostNis: number): number {
  if (maxAllowedCostNis > 0) return Math.round((costNis / maxAllowedCostNis) * 1000) / 10;
  return costNis > 0 ? 100 : 0;
}

function leadExceedsCostCap(params: {
  costNis: number;
  workedMs: number;
  maxAllowedCostNis: number;
}): boolean {
  const { costNis, workedMs, maxAllowedCostNis } = params;
  if (maxAllowedCostNis > 0) return costNis > maxAllowedCostNis + 0.005;
  // Lead value / max is 0 — any allocated time or cost is over budget
  return costNis > 0.005 || workedMs > 0;
}

const ALLOCATION_ITEM_PAGE = 800;
const LEAD_LOOKUP_CHUNK = 80;

function isTruncatedResponse(error: unknown): boolean {
  const message =
    error && typeof error === 'object' && 'message' in error
      ? String((error as { message: unknown }).message)
      : '';
  return message.includes('Content-Length');
}

async function fetchAllocationItemsInRange(params: {
  fromDate: string;
  toDate: string;
  leadFilter?: {
    leadType?: LeadReportingType | null;
    newLeadId?: string | null;
    legacyLeadId?: number | null;
    leadNumber?: string | null;
  };
}): Promise<AllocItemJoin[]> {
  const all: AllocItemJoin[] = [];
  for (let from = 0; ; from += ALLOCATION_ITEM_PAGE) {
    const loadPage = () => {
      let pageQuery = supabase
        .from('employee_daily_lead_allocation_items')
        .select(
          `
      id,
      percent,
      lead_number,
      lead_type,
      new_lead_id,
      legacy_lead_id,
      client_name,
      employee_daily_lead_allocations!inner (
        employee_id,
        work_date,
        tenants_employee!employee_id (
          id,
          display_name,
          photo_url,
          min_hours,
          department_id,
          tenant_departement!department_id ( id, name )
        )
      )
    `,
        )
        .gte('employee_daily_lead_allocations.work_date', params.fromDate)
        .lte('employee_daily_lead_allocations.work_date', params.toDate)
        .order('id', { ascending: true });
      if (params.leadFilter?.leadType === 'legacy' && params.leadFilter.legacyLeadId != null) {
        pageQuery = pageQuery.eq('legacy_lead_id', params.leadFilter.legacyLeadId);
      } else if (params.leadFilter?.newLeadId) {
        pageQuery = pageQuery.eq('new_lead_id', params.leadFilter.newLeadId);
      } else if (params.leadFilter?.leadNumber) {
        pageQuery = pageQuery.eq('lead_number', params.leadFilter.leadNumber);
      }
      return pageQuery.range(from, from + ALLOCATION_ITEM_PAGE - 1);
    };

    let { data, error } = await loadPage();
    if (error && isTruncatedResponse(error)) {
      ({ data, error } = await loadPage());
    }
    if (error) throw error;
    const batch = (data || []) as AllocItemJoin[];
    all.push(...batch);
    if (batch.length < ALLOCATION_ITEM_PAGE) break;
  }
  return all;
}

export type LeadBudgetSnapshot = {
  utilizationPercent: number;
  exceedsCap: boolean;
  hasCap: boolean;
};

const ALLOCATION_ITEM_SELECT = `
      id,
      percent,
      lead_number,
      lead_type,
      new_lead_id,
      legacy_lead_id,
      client_name,
      employee_daily_lead_allocations!inner (
        employee_id,
        work_date,
        tenants_employee!employee_id (
          id,
          display_name,
          photo_url,
          min_hours,
          department_id,
          tenant_departement!department_id ( id, name )
        )
      )
    `;

async function fetchAllocationItemsByColumn(
  column: 'new_lead_id' | 'legacy_lead_id' | 'lead_number',
  ids: Array<string | number>,
): Promise<AllocItemJoin[]> {
  if (ids.length === 0) return [];
  const all: AllocItemJoin[] = [];
  for (let from = 0; ; from += ALLOCATION_ITEM_PAGE) {
    const loadPage = () =>
      supabase
        .from('employee_daily_lead_allocation_items')
        .select(ALLOCATION_ITEM_SELECT)
        .in(column, ids)
        .order('id', { ascending: true })
        .range(from, from + ALLOCATION_ITEM_PAGE - 1);
    let { data, error } = await loadPage();
    if (error && isTruncatedResponse(error)) {
      ({ data, error } = await loadPage());
    }
    if (error) throw error;
    const batch = (data || []) as AllocItemJoin[];
    all.push(...batch);
    if (batch.length < ALLOCATION_ITEM_PAGE) break;
  }
  return all;
}

/** Budget status for specific leads. Amounts stay inside this module. */
export async function fetchLeadBudgetSnapshots(
  leads: Array<{
    leadType: LeadReportingType | null;
    newLeadId: string | null;
    legacyLeadId: number | null;
    leadNumber: string;
  }>,
): Promise<Map<string, LeadBudgetSnapshot>> {
  const snapshots = new Map<string, LeadBudgetSnapshot>();
  const stubs = new Map<
    string,
    {
      key: string;
      leadType: LeadReportingType | null;
      newLeadId: string | null;
      legacyLeadId: number | null;
      leadNumber: string;
    }
  >();
  for (const lead of leads) {
    const key = leadKeyFromItem({
      lead_type: lead.leadType,
      new_lead_id: lead.newLeadId,
      legacy_lead_id: lead.legacyLeadId,
      lead_number: lead.leadNumber,
    });
    if (!key || stubs.has(key)) continue;
    stubs.set(key, {
      key,
      leadType: lead.leadType,
      newLeadId: lead.newLeadId,
      legacyLeadId: lead.legacyLeadId,
      leadNumber: lead.leadNumber,
    });
  }
  if (stubs.size === 0) return snapshots;

  const newIds = [...new Set([...stubs.values()].map((lead) => lead.newLeadId).filter((id): id is string => Boolean(id)))];
  const legacyIds = [
    ...new Set(
      [...stubs.values()]
        .filter((lead) => lead.leadType === 'legacy' && lead.legacyLeadId != null)
        .map((lead) => lead.legacyLeadId as number),
    ),
  ];
  const numbers = [
    ...new Set(
      [...stubs.values()]
        .filter((lead) => !lead.newLeadId && lead.legacyLeadId == null && lead.leadNumber && lead.leadNumber !== '—')
        .map((lead) => lead.leadNumber),
    ),
  ];

  const itemGroups = await Promise.all([
    selectInChunks((chunk) => fetchAllocationItemsByColumn('new_lead_id', chunk).then((data) => ({ data, error: null })), newIds),
    selectInChunks((chunk) => fetchAllocationItemsByColumn('legacy_lead_id', chunk).then((data) => ({ data, error: null })), legacyIds),
    selectInChunks((chunk) => fetchAllocationItemsByColumn('lead_number', chunk).then((data) => ({ data, error: null })), numbers),
  ]);
  const seenIds = new Set<number>();
  const items: AllocItemJoin[] = [];
  for (const item of itemGroups.flat()) {
    if (seenIds.has(item.id)) continue;
    seenIds.add(item.id);
    items.push(item);
  }
  if (items.length === 0) return snapshots;

  const employeeIds = new Set<number>();
  let minDate = items[0]?.employee_daily_lead_allocations?.work_date || getJerusalemTodayIsoDate();
  let maxDate = minDate;
  for (const item of items) {
    const alloc = item.employee_daily_lead_allocations;
    if (!alloc) continue;
    employeeIds.add(alloc.employee_id);
    if (alloc.work_date < minDate) minDate = alloc.work_date;
    if (alloc.work_date > maxDate) maxDate = alloc.work_date;
  }

  const [salaryMap, clockRecords, metaByKey, requestsByLead, overridesByKey] = await Promise.all([
    fetchAverageGrossSalaryLastMonths(Array.from(employeeIds), 6),
    fetchClockInRecordsForAllocationMs(minDate, maxDate),
    fetchLeadMetaBatch([...stubs.values()]),
    fetchBudgetExtensionRequestsForLeads(
      [...stubs.values()].map((lead) => ({
        leadType: lead.leadType,
        newLeadId: lead.newLeadId,
        legacyLeadId: lead.legacyLeadId,
        leadNumber: lead.leadNumber,
      })),
    ),
    fetchLeadCostMaxOverridesForLeads(
      [...stubs.values()].map((lead) => ({
        leadType: lead.leadType,
        newLeadId: lead.newLeadId,
        legacyLeadId: lead.legacyLeadId,
        leadNumber: lead.leadNumber,
      })),
    ),
  ]);
  const byLead = accumulateItems({
    items,
    clockMsByEmpDate: buildAllocationClockInMsByEmployeeDate(clockRecords),
    salaryMap,
  });

  for (const lead of byLead.values()) {
    if (!stubs.has(lead.key)) continue;
    const meta = metaByKey.get(lead.key) || EMPTY_LEAD_META;
    const reqs = requestsByLead.get(lead.key) || [];
    const approvedExtensionCostNis =
      Math.round(
        reqs.filter((request) => request.status === 'approved').reduce((sum, request) => sum + (request.approvedExtraCostNis || 0), 0) * 100,
      ) / 100;
    const ref = {
      leadType: lead.leadType,
      newLeadId: lead.newLeadId,
      legacyLeadId: lead.legacyLeadId,
      leadNumber: lead.leadNumber,
    };
    const overrideKey = leadOverrideStorageKey(ref);
    const row = finalizeLeadRow(lead, meta, {
      approvedExtensionCostNis,
      budgetRequests: reqs,
      maxOverrideNis: overrideKey ? overridesByKey.get(overrideKey) ?? null : null,
    });
    snapshots.set(lead.key, {
      utilizationPercent: row.utilizationPercent,
      exceedsCap: row.exceedsCap,
      hasCap: row.maxAllowedCostNis > 0,
    });
  }
  return snapshots;
}

type LeadAgg = {
  key: string;
  leadType: LeadReportingType | null;
  newLeadId: string | null;
  legacyLeadId: number | null;
  leadNumber: string;
  clientName: string;
  byEmployee: Map<
    number,
    {
      employeeId: number;
      employeeName: string;
      photoUrl: string | null;
      departmentName: string | null;
      workedMs: number;
      costNis: number;
      hourRateNis: number | null;
      lastWorkDate: string | null;
    }
  >;
  byDayEmployee: Map<
    string,
    {
      workDate: string;
      employeeId: number;
      employeeName: string;
      photoUrl: string | null;
      departmentName: string | null;
      workedMs: number;
      costNis: number;
      hourRateNis: number | null;
    }
  >;
  workedMs: number;
  costNis: number;
};

function accumulateItems(params: {
  items: AllocItemJoin[];
  clockMsByEmpDate: Map<string, number>;
  salaryMap: Map<number, number>;
  employeeSearch?: string;
}): Map<string, LeadAgg> {
  const search = params.employeeSearch?.trim().toLowerCase() || '';
  const byLead = new Map<string, LeadAgg>();

  for (const item of params.items) {
    const alloc = item.employee_daily_lead_allocations;
    if (!alloc) continue;
    const key = leadKeyFromItem(item);
    if (!key) continue;

    const empRaw = alloc.tenants_employee;
    const emp = Array.isArray(empRaw) ? empRaw[0] : empRaw;
    const deptRaw = emp?.tenant_departement;
    const dept = Array.isArray(deptRaw) ? deptRaw[0] : deptRaw;
    const employeeName = emp?.display_name?.trim() || `Employee #${alloc.employee_id}`;
    if (search && !employeeName.toLowerCase().includes(search)) continue;

    const minHours = normalizeEmployeeMinHours(emp?.min_hours);
    const avgSalary = params.salaryMap.get(alloc.employee_id) ?? 0;
    const hourRateNis = salaryToHourlyRateNis(avgSalary > 0 ? avgSalary : null, minHours);
    const dayWorkedMs =
      params.clockMsByEmpDate.get(
        allocationEmployeeDateKey(alloc.employee_id, alloc.work_date),
      ) ?? 0;
    const workedMs = allocationPercentToWorkedMs(dayWorkedMs, Number(item.percent) || 0);
    const costNis = workedMsAtHourlyRateToCostNis(workedMs, hourRateNis) ?? 0;
    const photoUrl =
      (typeof emp?.photo_url === 'string' && emp.photo_url.trim()) ||
      (typeof emp?.photo === 'string' && emp.photo.trim()) ||
      null;
    const departmentName = dept?.name?.trim() || null;

    let lead = byLead.get(key);
    if (!lead) {
      lead = {
        key,
        leadType: (item.lead_type as LeadReportingType | null) || null,
        newLeadId: item.new_lead_id,
        legacyLeadId: item.legacy_lead_id,
        leadNumber: String(item.lead_number || '').trim() || '—',
        clientName: String(item.client_name || '').trim() || 'Unknown client',
        byEmployee: new Map(),
        byDayEmployee: new Map(),
        workedMs: 0,
        costNis: 0,
      };
      byLead.set(key, lead);
    }

    lead.workedMs += workedMs;
    lead.costNis += costNis;

    let empAgg = lead.byEmployee.get(alloc.employee_id);
    if (!empAgg) {
      empAgg = {
        employeeId: alloc.employee_id,
        employeeName,
        photoUrl,
        departmentName,
        workedMs: 0,
        costNis: 0,
        hourRateNis,
        lastWorkDate: null,
      };
      lead.byEmployee.set(alloc.employee_id, empAgg);
    }
    empAgg.workedMs += workedMs;
    empAgg.costNis += costNis;
    empAgg.hourRateNis = hourRateNis;
    const workDate = String(alloc.work_date || '').slice(0, 10);
    if (workDate && (!empAgg.lastWorkDate || workDate > empAgg.lastWorkDate)) {
      empAgg.lastWorkDate = workDate;
    }

    const dayKey = `${alloc.work_date}|${alloc.employee_id}`;
    let dayEmp = lead.byDayEmployee.get(dayKey);
    if (!dayEmp) {
      dayEmp = {
        workDate: alloc.work_date,
        employeeId: alloc.employee_id,
        employeeName,
        photoUrl,
        departmentName,
        workedMs: 0,
        costNis: 0,
        hourRateNis,
      };
      lead.byDayEmployee.set(dayKey, dayEmp);
    }
    dayEmp.workedMs += workedMs;
    dayEmp.costNis += costNis;
  }

  return byLead;
}

function finalizeLeadRow(
  lead: LeadAgg,
  meta: {
    category: string | null;
    mainCategory: string | null;
    subcategory: string | null;
    leadTotalValueNis: number;
    clientName: string | null;
    hasPaymentPlan?: boolean;
    stageId?: number | null;
    balanceAmount?: number | null;
  },
  extensions?: {
    approvedExtensionCostNis: number;
    budgetRequests: LeadBudgetExtensionRequest[];
    maxOverrideNis?: number | null;
  },
): LeadManagementLeadRow {
  const costNis = Math.round(lead.costNis * 100) / 100;
  const baseMaxAllowedCostNis = maxLeadEmployeeCostNis(meta.leadTotalValueNis);
  const approvedExtensionCostNis = extensions?.approvedExtensionCostNis ?? 0;
  const maxOverrideNis =
    extensions?.maxOverrideNis != null && Number.isFinite(extensions.maxOverrideNis)
      ? Math.round(Math.max(0, Number(extensions.maxOverrideNis)) * 100) / 100
      : null;
  const maxAllowedCostNis = resolveEffectiveMaxAllowedCostNis({
    baseMaxAllowedCostNis,
    approvedExtensionCostNis,
    maxOverrideNis,
  });
  const budgetRequests = extensions?.budgetRequests ?? [];
  const employees = Array.from(lead.byEmployee.values())
    .map((e) => ({
      ...e,
      costNis: Math.round(e.costNis * 100) / 100,
      hourRateNis:
        e.hourRateNis != null && Number.isFinite(e.hourRateNis)
          ? Math.round(e.hourRateNis * 100) / 100
          : null,
      missingSalary: !(e.hourRateNis != null && e.hourRateNis > 0),
    }))
    .sort((a, b) => b.costNis - a.costNis || a.employeeName.localeCompare(b.employeeName));
  const daySlices: LeadManagementDaySlice[] = Array.from(lead.byDayEmployee.values()).map((slice) => ({
    workDate: String(slice.workDate || '').slice(0, 10),
    employeeId: slice.employeeId,
    employeeName: slice.employeeName,
    photoUrl: slice.photoUrl,
    departmentName: slice.departmentName,
    workedMs: slice.workedMs,
    costNis: Math.round(slice.costNis * 100) / 100,
    hourRateNis:
      slice.hourRateNis != null && Number.isFinite(slice.hourRateNis)
        ? Math.round(slice.hourRateNis * 100) / 100
        : null,
  }));

  return {
    key: lead.key,
    leadType: lead.leadType,
    newLeadId: lead.newLeadId,
    legacyLeadId: lead.legacyLeadId,
    leadNumber: lead.leadNumber,
    clientName: meta.clientName || lead.clientName,
    contactNames: [],
    category: meta.category,
    mainCategory: meta.mainCategory,
    subcategory: meta.subcategory,
    workedMs: lead.workedMs,
    costNis,
    maxAllowedCostNis,
    baseMaxAllowedCostNis,
    approvedExtensionCostNis,
    maxOverrideNis,
    leadTotalValueNis: meta.leadTotalValueNis,
    hasPaymentPlan: meta.hasPaymentPlan === true,
    utilizationPercent: utilizationPercent(costNis, maxAllowedCostNis),
    exceedsCap: leadExceedsCostCap({
      costNis,
      workedMs: lead.workedMs,
      maxAllowedCostNis,
    }),
    stageId: meta.stageId ?? null,
    missingBalance: missingHandlingBalance(meta.stageId ?? null, meta.balanceAmount ?? null),
    employees,
    daySlices,
    budgetRequests,
    pendingRequestCount: budgetRequests.filter((r) => r.status === 'pending').length,
    requestCount: budgetRequests.length,
  };
}

async function attachContactNamesToRows(
  rows: LeadManagementLeadRow[],
): Promise<LeadManagementLeadRow[]> {
  if (rows.length === 0) return rows;

  const newIds = Array.from(
    new Set(rows.map((r) => r.newLeadId).filter((id): id is string => Boolean(id))),
  );
  const legacyIds = Array.from(
    new Set(
      rows
        .map((r) => r.legacyLeadId)
        .filter((id): id is number => id != null && Number.isFinite(id)),
    ),
  );

  type Rel = { leadKey: string; contactId: number };
  const relations: Rel[] = [];

  const fetches: Promise<void>[] = [];
  if (newIds.length > 0) {
    fetches.push(
      (async () => {
        try {
          const data = await selectInChunks<{ contact_id: number | null; newlead_id: string | null }>(
            (chunk) =>
              supabase
                .from('lead_leadcontact')
                .select('contact_id, newlead_id')
                .in('newlead_id', chunk as string[]),
            newIds,
          );
          for (const row of data) {
            if (row.contact_id == null || !row.newlead_id) continue;
            relations.push({ leadKey: `new:${row.newlead_id}`, contactId: Number(row.contact_id) });
          }
        } catch (error) {
          console.error('[leadsManagementReport] contact links (new) failed:', error);
        }
      })(),
    );
  }
  if (legacyIds.length > 0) {
    fetches.push(
      (async () => {
        try {
          const data = await selectInChunks<{ contact_id: number | null; lead_id: number | null }>(
            (chunk) =>
              supabase
                .from('lead_leadcontact')
                .select('contact_id, lead_id')
                .in('lead_id', chunk as number[]),
            legacyIds,
          );
          for (const row of data) {
            if (row.contact_id == null || row.lead_id == null) continue;
            relations.push({
              leadKey: `legacy:${row.lead_id}`,
              contactId: Number(row.contact_id),
            });
          }
        } catch (error) {
          console.error('[leadsManagementReport] contact links (legacy) failed:', error);
        }
      })(),
    );
  }
  await Promise.all(fetches);

  if (relations.length === 0) return rows;

  const contactIds = Array.from(new Set(relations.map((r) => r.contactId)));
  let contacts: Array<{ id: number; name: string | null }> = [];
  try {
    contacts = await selectInChunks<{ id: number; name: string | null }>(
      (chunk) => supabase.from('leads_contact').select('id, name').in('id', chunk as number[]),
      contactIds,
    );
  } catch (contactsError) {
    console.error('[leadsManagementReport] contact names failed:', contactsError);
    return rows;
  }

  const nameById = new Map<number, string>();
  for (const c of contacts || []) {
    const name = c.name != null ? String(c.name).trim() : '';
    if (name) nameById.set(Number(c.id), name);
  }

  const namesByLeadKey = new Map<string, string[]>();
  for (const rel of relations) {
    const name = nameById.get(rel.contactId);
    if (!name) continue;
    const list = namesByLeadKey.get(rel.leadKey) || [];
    if (!list.includes(name)) list.push(name);
    namesByLeadKey.set(rel.leadKey, list);
  }

  return rows.map((row) => {
    const key =
      row.leadType === 'legacy' && row.legacyLeadId != null
        ? `legacy:${row.legacyLeadId}`
        : row.newLeadId
          ? `new:${row.newLeadId}`
          : row.key;
    return {
      ...row,
      contactNames: namesByLeadKey.get(key) || [],
    };
  });
}

/** Limit a lead to the reported days inside From / To. Empty bounds keep the full lead. */
export function leadRowForDateRange(
  row: LeadManagementLeadRow,
  from: string,
  to: string,
): LeadManagementLeadRow | null {
  const start = from.trim();
  const end = to.trim();
  if (!start && !end) return row;
  const slices = (row.daySlices || []).filter((slice) => {
    const date = String(slice.workDate || '').slice(0, 10);
    if (!date) return false;
    if (start && date < start) return false;
    if (end && date > end) return false;
    return true;
  });
  if (slices.length === 0) return null;

  const byEmployee = new Map<number, LeadManagementEmployeeSlice>();
  let workedMs = 0;
  let costNis = 0;
  for (const slice of slices) {
    workedMs += slice.workedMs;
    costNis += slice.costNis;
    const current = byEmployee.get(slice.employeeId) || {
      employeeId: slice.employeeId,
      employeeName: slice.employeeName,
      photoUrl: slice.photoUrl,
      departmentName: slice.departmentName,
      workedMs: 0,
      costNis: 0,
      hourRateNis: slice.hourRateNis,
      missingSalary: !(slice.hourRateNis != null && slice.hourRateNis > 0),
      lastWorkDate: null as string | null,
    };
    current.workedMs += slice.workedMs;
    current.costNis += slice.costNis;
    current.hourRateNis = slice.hourRateNis;
    current.missingSalary = !(slice.hourRateNis != null && slice.hourRateNis > 0);
    if (!current.lastWorkDate || slice.workDate > current.lastWorkDate) current.lastWorkDate = slice.workDate;
    byEmployee.set(slice.employeeId, current);
  }
  costNis = Math.round(costNis * 100) / 100;
  const employees = [...byEmployee.values()]
    .map((employee) => ({ ...employee, costNis: Math.round(employee.costNis * 100) / 100 }))
    .sort((a, b) => b.costNis - a.costNis || a.employeeName.localeCompare(b.employeeName));

  return {
    ...row,
    workedMs,
    costNis,
    employees,
    daySlices: slices,
    utilizationPercent: utilizationPercent(costNis, row.maxAllowedCostNis),
    exceedsCap: leadExceedsCostCap({ costNis, workedMs, maxAllowedCostNis: row.maxAllowedCostNis }),
  };
}

export function leadMatchesSearchQuery(row: LeadManagementLeadRow, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  if (row.leadNumber.toLowerCase().includes(q)) return true;
  if (row.clientName.toLowerCase().includes(q)) return true;
  return row.contactNames.some((name) => name.toLowerCase().includes(q));
}

export function leadMatchesEmployeeQuery(row: LeadManagementLeadRow, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  return row.employees.some((employee) => employee.employeeName.toLowerCase().includes(q));
}

const REPORT_CACHE_MS = 90_000;
let reportCache: { key: string; at: number; rows: LeadManagementLeadRow[] } | null = null;
let reportInflight: { key: string; promise: Promise<LeadManagementLeadRow[]> } | null = null;
let knownSuperUser: boolean | null = null;

function reportCacheKey(params: { employeeSearch?: string; category?: string | null } = {}) {
  return `${params.employeeSearch || ''}|${params.category || ''}`;
}

/** Cached rows for this filter, or null when the page still has to load. */
export function peekLeadsManagementReport(params: {
  employeeSearch?: string;
  category?: string | null;
} = {}): LeadManagementLeadRow[] | null {
  if (!reportCache || reportCache.key !== reportCacheKey(params)) return null;
  if (reportListeners.size === 0 && Date.now() - reportCache.at >= REPORT_CACHE_MS) return null;
  return reportCache.rows;
}

export function peekLeadsManagementSuperUser(): boolean | null {
  return knownSuperUser;
}

export function rememberLeadsManagementSuperUser(value: boolean) {
  knownSuperUser = value;
}

/**
 * Report of all leads that have allocation data (all-time totals per lead).
 * A recent result is reused so opening an employee from this list does not load it again.
 */
export async function fetchLeadsManagementReport(params: {
  employeeSearch?: string;
  category?: string | null;
  fresh?: boolean;
} = {}): Promise<LeadManagementLeadRow[]> {
  const key = reportCacheKey(params);
  if (params.fresh) reportCache = null;
  const cacheIsWarm =
    reportCache &&
    reportCache.key === key &&
    (reportListeners.size > 0 || Date.now() - reportCache.at < REPORT_CACHE_MS);
  if (cacheIsWarm && reportCache) {
    return reportCache.rows;
  }
  if (reportInflight?.key === key) return reportInflight.promise;

  const promise = loadLeadsManagementReport(params)
    .then((rows) => {
      reportCache = { key, at: Date.now(), rows };
      return rows;
    })
    .finally(() => {
      if (reportInflight?.promise === promise) reportInflight = null;
    });
  reportInflight = { key, promise };
  return promise;
}

const reportListeners = new Set<(rows: LeadManagementLeadRow[]) => void>();
const pendingLeadKeys = new Set<string>();
let patchTimer: ReturnType<typeof setTimeout> | null = null;
let reportChannel: ReturnType<typeof supabase.channel> | null = null;

function leadKeyFromPayload(record: Record<string, unknown> | null | undefined): string | null {
  if (!record) return null;
  return leadKeyFromItem({
    lead_type: (record.lead_type as string | null) ?? null,
    new_lead_id: (record.new_lead_id as string | null) ?? (record.newlead_id as string | null) ?? null,
    legacy_lead_id:
      record.legacy_lead_id != null
        ? Number(record.legacy_lead_id)
        : null,
    lead_number: (record.lead_number as string | null) ?? null,
  });
}

function publishReportRows(rows: LeadManagementLeadRow[]) {
  if (!reportCache) return;
  reportCache = { ...reportCache, at: Date.now(), rows };
  for (const listener of reportListeners) listener(rows);
}

function cacheAllowsLiveInsert(): boolean {
  if (!reportCache) return false;
  const [employeeSearch, category] = reportCache.key.split('|');
  return !employeeSearch && !category;
}

async function refreshCachedLead(key: string) {
  if (!reportCache || reportCache.key.split('|')[0]) return;
  let params: {
    leadType?: LeadReportingType | null;
    newLeadId?: string | null;
    legacyLeadId?: number | null;
    leadNumber?: string | null;
  } | null = null;
  if (key.startsWith('legacy:')) {
    params = { leadType: 'legacy', legacyLeadId: Number(key.slice(7)) };
  } else if (key.startsWith('new:')) {
    params = { leadType: 'new', newLeadId: key.slice(4) };
  } else if (key.startsWith('number:')) {
    params = { leadNumber: key.slice(7) };
  }
  if (!params) return;
  const detail = await fetchLeadManagementDetail(params);
  const prev = reportCache.rows;
  const index = prev.findIndex((row) => row.key === key);
  const category = reportCache.key.split('|')[1] || '';
  const lead = detail?.lead ?? null;
  const categoryOk = !category || (lead?.mainCategory || '').toLowerCase() === category.toLowerCase();
  let next = prev;
  if (!lead || !categoryOk || (lead.workedMs <= 0 && lead.costNis <= 0 && lead.employees.length === 0)) {
    if (index < 0) return;
    next = prev.filter((row) => row.key !== key);
  } else {
    const merged = {
      ...lead,
      contactNames: index >= 0 ? prev[index].contactNames : lead.contactNames,
    };
    if (index >= 0) next = prev.map((row) => (row.key === key ? merged : row));
    else if (cacheAllowsLiveInsert()) next = [...prev, merged];
    else return;
    next = [...next].sort((a, b) => b.costNis - a.costNis || a.leadNumber.localeCompare(b.leadNumber));
  }
  publishReportRows(next);
}

function scheduleLeadRefresh(key: string | null) {
  if (!key || !reportCache || reportCache.key.split('|')[0]) return;
  pendingLeadKeys.add(key);
  if (patchTimer) clearTimeout(patchTimer);
  patchTimer = setTimeout(() => {
    patchTimer = null;
    void flushLeadRefreshes();
  }, 500);
}

async function flushLeadRefreshes() {
  if (reportInflight) {
    patchTimer = setTimeout(() => {
      patchTimer = null;
      void flushLeadRefreshes();
    }, 500);
    return;
  }
  const keys = [...pendingLeadKeys];
  pendingLeadKeys.clear();
  for (const key of keys) {
    try {
      await refreshCachedLead(key);
    } catch (error) {
      console.error('[leadsManagementReport] live lead refresh failed:', error);
    }
  }
}

async function queueAllocationParent(allocationId: number) {
  const { data, error } = await supabase
    .from('employee_daily_lead_allocation_items')
    .select('lead_type, new_lead_id, legacy_lead_id, lead_number')
    .eq('allocation_id', allocationId);
  if (error) {
    console.error('[leadsManagementReport] allocation lookup failed:', error);
    return;
  }
  for (const row of data || []) scheduleLeadRefresh(leadKeyFromItem(row));
}

async function queueClockChange(employeeId: number, clockInTime: string) {
  const workDate = getJerusalemTodayIsoDate(new Date(clockInTime));
  const { data, error } = await supabase
    .from('employee_daily_lead_allocation_items')
    .select(
      `
      lead_type, new_lead_id, legacy_lead_id, lead_number,
      employee_daily_lead_allocations!inner ( employee_id, work_date )
    `,
    )
    .eq('employee_daily_lead_allocations.employee_id', employeeId)
    .eq('employee_daily_lead_allocations.work_date', workDate);
  if (error) {
    console.error('[leadsManagementReport] clock lead lookup failed:', error);
    return;
  }
  for (const row of data || []) scheduleLeadRefresh(leadKeyFromItem(row));
}

function queueFromRealtime(table: string, record: Record<string, unknown> | null) {
  if (!record) return;
  if (table === 'leads') {
    scheduleLeadRefresh(record.id ? `new:${record.id}` : null);
    return;
  }
  if (table === 'leads_lead') {
    scheduleLeadRefresh(record.id != null ? `legacy:${record.id}` : null);
    return;
  }
  if (table === 'finances_paymentplanrow') {
    scheduleLeadRefresh(record.lead_id != null ? `legacy:${record.lead_id}` : null);
    return;
  }
  if (table === 'payment_plans') {
    const leadId = record.lead_id || record.lead_ids;
    scheduleLeadRefresh(leadId ? `new:${leadId}` : null);
    return;
  }
  scheduleLeadRefresh(leadKeyFromPayload(record));
}

function ensureReportChannel() {
  if (reportChannel) return;
  const tables = [
    'employee_daily_lead_allocation_items',
    'employee_daily_lead_allocations',
    'employee_clock_in',
    'leads',
    'leads_lead',
    'payment_plans',
    'finances_paymentplanrow',
    'lead_expenses',
    'lead_employee_budget_extension_requests',
    'lead_employee_cost_max_overrides',
  ];
  let channel = supabase.channel('leads-management-report');
  for (const table of tables) {
    channel = channel.on(
      'postgres_changes',
      { event: '*', schema: 'public', table },
      (payload) => {
        const record = (payload.new && Object.keys(payload.new).length > 0
          ? payload.new
          : payload.old) as Record<string, unknown> | null;
        if (table === 'employee_daily_lead_allocations') {
          const id = Number(record?.id);
          if (Number.isFinite(id)) void queueAllocationParent(id);
          return;
        }
        if (table === 'employee_clock_in') {
          const employeeId = Number(record?.employee_id);
          const clockIn = record?.clock_in_time != null ? String(record.clock_in_time) : '';
          if (Number.isFinite(employeeId) && clockIn) void queueClockChange(employeeId, clockIn);
          return;
        }
        queueFromRealtime(table, record);
      },
    );
  }
  reportChannel = channel.subscribe();
}

/** Live updates replace one lead in the cache. Open pages receive the new rows without a full reload. */
export function subscribeLeadsManagementReport(
  listener: (rows: LeadManagementLeadRow[]) => void,
): () => void {
  reportListeners.add(listener);
  ensureReportChannel();
  return () => {
    reportListeners.delete(listener);
    if (reportListeners.size === 0 && reportChannel) {
      void supabase.removeChannel(reportChannel);
      reportChannel = null;
    }
  };
}

async function loadLeadsManagementReport(params: {
  employeeSearch?: string;
  category?: string | null;
}): Promise<LeadManagementLeadRow[]> {
  const items = await fetchAllocationItemsInRange({
    fromDate: '1970-01-01',
    toDate: '2999-12-31',
  });
  if (items.length === 0) return [];

  const employeeIds = new Set<number>();
  let minDate = items[0]?.employee_daily_lead_allocations?.work_date || getJerusalemTodayIsoDate();
  let maxDate = minDate;
  for (const item of items) {
    const alloc = item.employee_daily_lead_allocations;
    if (!alloc) continue;
    employeeIds.add(alloc.employee_id);
    if (alloc.work_date < minDate) minDate = alloc.work_date;
    if (alloc.work_date > maxDate) maxDate = alloc.work_date;
  }

  const leadStubs = new Map<
    string,
    {
      key: string;
      leadType: LeadReportingType | null;
      newLeadId: string | null;
      legacyLeadId: number | null;
      leadNumber: string;
    }
  >();
  for (const item of items) {
    const key = leadKeyFromItem(item);
    if (!key || leadStubs.has(key)) continue;
    leadStubs.set(key, {
      key,
      leadType: (item.lead_type as LeadReportingType | null) || null,
      newLeadId: item.new_lead_id,
      legacyLeadId: item.legacy_lead_id,
      leadNumber: String(item.lead_number || '').trim() || '—',
    });
  }

  const metaPromise = fetchLeadMetaBatch([...leadStubs.values()]);
  const [salaryMap, clockRecords] = await Promise.all([
    fetchAverageGrossSalaryLastMonths(Array.from(employeeIds), 6),
    fetchClockInRecordsForAllocationMs(minDate, maxDate),
  ]);
  const clockMsByEmpDate = buildAllocationClockInMsByEmployeeDate(clockRecords);

  const byLead = accumulateItems({
    items,
    clockMsByEmpDate,
    salaryMap,
    employeeSearch: params.employeeSearch,
  });

  const leads = Array.from(byLead.values());
  const metaByKey = await metaPromise;
  const metas = leads.map((lead) => metaByKey.get(lead.key) || EMPTY_LEAD_META);

  const categoryFilter = params.category?.trim().toLowerCase() || '';
  const leadRefs = leads.map((lead) => ({
    leadType: lead.leadType,
    newLeadId: lead.newLeadId,
    legacyLeadId: lead.legacyLeadId,
    leadNumber: lead.leadNumber,
  }));
  const [requestsByLead, overridesByKey] = await Promise.all([
    fetchBudgetExtensionRequestsForLeads(leadRefs),
    fetchLeadCostMaxOverridesForLeads(leadRefs),
  ]);

  let rows = leads
    .map((lead, idx) => {
      const reqs = requestsByLead.get(lead.key) || [];
      const approvedExtensionCostNis =
        Math.round(
          reqs
            .filter((r) => r.status === 'approved')
            .reduce((sum, r) => sum + (r.approvedExtraCostNis || 0), 0) * 100,
        ) / 100;
      const overrideKey = leadOverrideStorageKey(leadRefs[idx]);
      const maxOverrideNis = overrideKey ? overridesByKey.get(overrideKey) ?? null : null;
      return finalizeLeadRow(lead, metas[idx], {
        approvedExtensionCostNis,
        budgetRequests: reqs,
        maxOverrideNis,
      });
    })
    .filter((row) => {
      if (!categoryFilter) return true;
      return (row.mainCategory || '').toLowerCase() === categoryFilter;
    })
    .sort((a, b) => b.costNis - a.costNis || a.leadNumber.localeCompare(b.leadNumber));

  rows = await attachContactNamesToRows(rows);
  return rows;
}

/**
 * All-time detail for one lead: totals + per-day employee breakdown.
 */
export async function fetchLeadManagementDetail(params: {
  leadType?: LeadReportingType | null;
  newLeadId?: string | null;
  legacyLeadId?: number | null;
  leadNumber?: string | null;
}): Promise<LeadManagementDetail | null> {
  const items = await fetchAllocationItemsInRange({
    fromDate: '1970-01-01',
    toDate: '2999-12-31',
    leadFilter: params,
  });
  if (items.length === 0) {
    const meta = await fetchLeadMeta({
      leadType: params.leadType || null,
      newLeadId: params.newLeadId || null,
      legacyLeadId: params.legacyLeadId ?? null,
      leadNumber: params.leadNumber || '',
    });
    const key =
      params.leadType === 'legacy' && params.legacyLeadId != null
        ? `legacy:${params.legacyLeadId}`
        : params.newLeadId
          ? `new:${params.newLeadId}`
          : params.leadNumber
            ? `number:${params.leadNumber}`
            : null;
    if (!key) return null;
    const leadRef = {
      leadType: params.leadType || null,
      newLeadId: params.newLeadId || null,
      legacyLeadId: params.legacyLeadId ?? null,
      leadNumber: params.leadNumber || null,
    };
    const [reqsMap, overridesByKey] = await Promise.all([
      fetchBudgetExtensionRequestsForLeads([leadRef]),
      fetchLeadCostMaxOverridesForLeads([leadRef]),
    ]);
    const reqs = reqsMap.get(key) || [];
    const approvedExtensionCostNis =
      Math.round(
        reqs
          .filter((r) => r.status === 'approved')
          .reduce((sum, r) => sum + (r.approvedExtraCostNis || 0), 0) * 100,
      ) / 100;
    const baseMax = maxLeadEmployeeCostNis(meta.leadTotalValueNis);
    const overrideKey = leadOverrideStorageKey(leadRef);
    const maxOverrideNis = overrideKey ? overridesByKey.get(overrideKey) ?? null : null;
    const maxAllowed = resolveEffectiveMaxAllowedCostNis({
      baseMaxAllowedCostNis: baseMax,
      approvedExtensionCostNis,
      maxOverrideNis,
    });
    return {
      lead: {
        key,
        leadType: params.leadType || null,
        newLeadId: params.newLeadId || null,
        legacyLeadId: params.legacyLeadId ?? null,
        leadNumber: params.leadNumber || '—',
        clientName: meta.clientName || 'Unknown client',
        contactNames: [],
        category: meta.category,
        mainCategory: meta.mainCategory,
        subcategory: meta.subcategory,
        workedMs: 0,
        costNis: 0,
        maxAllowedCostNis: maxAllowed,
        baseMaxAllowedCostNis: baseMax,
        approvedExtensionCostNis,
        maxOverrideNis,
        leadTotalValueNis: meta.leadTotalValueNis,
        hasPaymentPlan: meta.hasPaymentPlan === true,
        utilizationPercent: 0,
        exceedsCap: false,
        stageId: meta.stageId ?? null,
        missingBalance: missingHandlingBalance(meta.stageId ?? null, meta.balanceAmount ?? null),
        employees: [],
        daySlices: [],
        budgetRequests: reqs,
        pendingRequestCount: reqs.filter((r) => r.status === 'pending').length,
        requestCount: reqs.length,
      },
      days: [],
    };
  }

  const employeeIds = new Set<number>();
  let minDate = items[0]?.employee_daily_lead_allocations?.work_date || getJerusalemTodayIsoDate();
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
    fetchClockInRecordsForAllocationMs(minDate, maxDate),
  ]);
  const clockMsByEmpDate = buildAllocationClockInMsByEmployeeDate(clockRecords);
  const byLead = accumulateItems({ items, clockMsByEmpDate, salaryMap });
  const lead = Array.from(byLead.values())[0];
  if (!lead) return null;

  const meta = await fetchLeadMeta({
    leadType: lead.leadType,
    newLeadId: lead.newLeadId,
    legacyLeadId: lead.legacyLeadId,
    leadNumber: lead.leadNumber,
  });
  const leadRef = {
    leadType: lead.leadType,
    newLeadId: lead.newLeadId,
    legacyLeadId: lead.legacyLeadId,
    leadNumber: lead.leadNumber,
  };
  const [reqsMap, overridesByKey] = await Promise.all([
    fetchBudgetExtensionRequestsForLeads([leadRef]),
    fetchLeadCostMaxOverridesForLeads([leadRef]),
  ]);
  const reqs = reqsMap.get(lead.key) || [];
  const approvedExtensionCostNis =
    Math.round(
      reqs
        .filter((r) => r.status === 'approved')
        .reduce((sum, r) => sum + (r.approvedExtraCostNis || 0), 0) * 100,
    ) / 100;
  const overrideKey = leadOverrideStorageKey(leadRef);
  const maxOverrideNis = overrideKey ? overridesByKey.get(overrideKey) ?? null : null;
  const leadRow = finalizeLeadRow(lead, meta, {
    approvedExtensionCostNis,
    budgetRequests: reqs,
    maxOverrideNis,
  });

  const byDay = new Map<string, LeadManagementDayBreakdown>();
  for (const slice of lead.byDayEmployee.values()) {
    let day = byDay.get(slice.workDate);
    if (!day) {
      day = { workDate: slice.workDate, workedMs: 0, costNis: 0, employees: [] };
      byDay.set(slice.workDate, day);
    }
    day.workedMs += slice.workedMs;
    day.costNis += slice.costNis;
    day.employees.push({
      employeeId: slice.employeeId,
      employeeName: slice.employeeName,
      photoUrl: slice.photoUrl,
      departmentName: slice.departmentName,
      workedMs: slice.workedMs,
      costNis: Math.round(slice.costNis * 100) / 100,
      hourRateNis:
        slice.hourRateNis != null && Number.isFinite(slice.hourRateNis)
          ? Math.round(slice.hourRateNis * 100) / 100
          : null,
      missingSalary: !(slice.hourRateNis != null && slice.hourRateNis > 0),
      lastWorkDate: String(slice.workDate || '').slice(0, 10) || null,
    });
  }

  const days = Array.from(byDay.values())
    .map((day) => ({
      ...day,
      costNis: Math.round(day.costNis * 100) / 100,
      employees: day.employees.sort(
        (a, b) => b.costNis - a.costNis || a.employeeName.localeCompare(b.employeeName),
      ),
    }))
    .sort((a, b) => b.workDate.localeCompare(a.workDate));

  return { lead: leadRow, days };
}

export function buildLeadManagementDetailPath(row: {
  leadType: LeadReportingType | null;
  newLeadId: string | null;
  legacyLeadId: number | null;
  leadNumber: string;
}): string {
  const params = new URLSearchParams();
  if (row.leadType === 'legacy' && row.legacyLeadId != null) {
    params.set('type', 'legacy');
    params.set('id', String(row.legacyLeadId));
  } else if (row.newLeadId) {
    params.set('type', 'new');
    params.set('id', row.newLeadId);
  } else {
    params.set('type', 'number');
    params.set('id', row.leadNumber);
  }
  if (row.leadNumber && row.leadNumber !== '—') params.set('lead', row.leadNumber);
  return `/reports/leads-management/${encodeURIComponent(params.get('id') || row.leadNumber)}?${params.toString()}`;
}

export function buildLeadClientRoute(row: {
  leadType: LeadReportingType | null;
  legacyLeadId: number | null;
  leadNumber: string;
}): string | null {
  return buildClientRouteFromAllocationRow({
    lead_type: row.leadType,
    legacy_lead_id: row.legacyLeadId,
    lead_number: row.leadNumber,
  });
}

export function collectCategoriesFromRows(rows: LeadManagementLeadRow[]): string[] {
  const set = new Set<string>();
  for (const row of rows) {
    if (row.mainCategory) set.add(row.mainCategory);
  }
  return Array.from(set).sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }));
}

export { formatAllocationCostNis, formatAllocationWorkedDuration, getJerusalemTodayIsoDate, maxLeadEmployeeCostNis };
