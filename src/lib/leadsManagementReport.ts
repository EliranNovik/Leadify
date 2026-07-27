import { supabase } from './supabase';
import { filterCountedClockInRecords } from './employeeClockInApproval';
import {
  allocationPercentToWorkedMs,
  buildClientRouteFromAllocationRow,
  formatAllocationCostNis,
  formatAllocationWorkedDuration,
  getJerusalemTodayIsoDate,
  normalizeEmployeeMinHours,
  salaryToHourlyRateNis,
  workedMsAtHourlyRateToCostNis,
  type LeadReportingType,
} from './employeeLeadReporting';
import {
  maxLeadEmployeeCostNis,
  resolveLeadTotalValueNis,
} from './leadEmployeeCost';
import { isExpenseNoVatPayment } from './proformaVat';
import { fetchAverageGrossSalaryLastMonths } from './employeeSalaries';
import { fetchClockInRecordsInRangeForReport } from './workingHoursExport';
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
  /** Derived from avg salary ÷ (min hours × working days). */
  hourRateNis: number | null;
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
  employees: LeadManagementEmployeeSlice[];
  budgetRequests: LeadBudgetExtensionRequest[];
  pendingRequestCount: number;
  requestCount: number;
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

function employeeDateKey(employeeId: number, workDate: string): string {
  return `${employeeId}|${workDate}`;
}

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
  if (error || !data?.length) return null;
  let baseTotal = 0;
  let hasPlan = false;
  for (const row of data as Array<{ value?: unknown; payment_order?: unknown }>) {
    if (isExpenseNoVatPayment(row.payment_order)) continue;
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
  if (error || !data?.length) return null;
  let baseTotal = 0;
  let hasPlan = false;
  for (const row of data as Array<{ value?: unknown; order?: unknown }>) {
    if (isExpenseNoVatPayment(row.order)) continue;
    hasPlan = true;
    const base = Number(row.value ?? 0);
    if (Number.isFinite(base)) baseTotal += base;
  }
  return hasPlan ? baseTotal : null;
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
}> {
  if (params.leadType === 'legacy' && params.legacyLeadId != null) {
    const [{ data }, planBase] = await Promise.all([
      supabase
        .from('leads_lead')
        .select(
          `
          id, name, category, category_id, total, total_base, currency_id, manual_id,
          misc_category!leads_lead_category_id_fkey (
            id, name, parent_id,
            misc_maincategory!parent_id ( id, name )
          )
        `,
        )
        .eq('id', params.legacyLeadId)
        .maybeSingle(),
      fetchLegacyLeadPaymentPlanBaseTotal(params.legacyLeadId),
    ]);
    const leadTotalValueNis = resolveLeadTotalValueNis(
      data
        ? { ...data, lead_type: 'legacy', id: `legacy_${data.id}` }
        : { lead_type: 'legacy', id: `legacy_${params.legacyLeadId}` },
      { hasPaymentPlan: planBase != null, paymentPlanBaseTotal: planBase },
    );
    const cats = formatLeadCategoryParts(data);
    return {
      ...cats,
      leadTotalValueNis,
      clientName: data?.name != null ? String(data.name).trim() || null : null,
      hasPaymentPlan: planBase != null,
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
    const [{ data }, planBase] = await Promise.all([
      supabase
        .from('leads')
        .select(
          `
          id, name, category, category_id, balance, proposal_total, lead_number,
          misc_category!category_id (
            id, name, parent_id,
            misc_maincategory!parent_id ( id, name )
          )
        `,
        )
        .eq('id', newLeadId)
        .maybeSingle(),
      fetchNewLeadPaymentPlanBaseTotal(newLeadId),
    ]);
    const leadTotalValueNis = resolveLeadTotalValueNis(data ?? { id: newLeadId }, {
      hasPaymentPlan: planBase != null,
      paymentPlanBaseTotal: planBase,
    });
    const cats = formatLeadCategoryParts(data);
    return {
      ...cats,
      leadTotalValueNis,
      clientName: data?.name != null ? String(data.name).trim() || null : null,
      hasPaymentPlan: planBase != null,
    };
  }

  return {
    category: null,
    mainCategory: null,
    subcategory: null,
    leadTotalValueNis: 0,
    clientName: null,
    hasPaymentPlan: false,
  };
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
  let query = supabase.from('employee_daily_lead_allocation_items').select(
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
          photo,
          min_hours,
          department_id,
          tenant_departement!department_id ( id, name )
        )
      )
    `,
  );

  // Date range on the parent allocation row
  query = query
    .gte('employee_daily_lead_allocations.work_date', params.fromDate)
    .lte('employee_daily_lead_allocations.work_date', params.toDate);

  if (params.leadFilter?.leadType === 'legacy' && params.leadFilter.legacyLeadId != null) {
    query = query.eq('legacy_lead_id', params.leadFilter.legacyLeadId);
  } else if (params.leadFilter?.newLeadId) {
    query = query.eq('new_lead_id', params.leadFilter.newLeadId);
  } else if (params.leadFilter?.leadNumber) {
    query = query.eq('lead_number', params.leadFilter.leadNumber);
  }

  const { data, error } = await query;
  if (error) throw error;

  return (data || []) as AllocItemJoin[];
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
      params.clockMsByEmpDate.get(employeeDateKey(alloc.employee_id, alloc.work_date)) ?? 0;
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
      };
      lead.byEmployee.set(alloc.employee_id, empAgg);
    }
    empAgg.workedMs += workedMs;
    empAgg.costNis += costNis;
    empAgg.hourRateNis = hourRateNis;

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
    }))
    .sort((a, b) => b.costNis - a.costNis || a.employeeName.localeCompare(b.employeeName));

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
    employees,
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
        const { data, error } = await supabase
          .from('lead_leadcontact')
          .select('contact_id, newlead_id')
          .in('newlead_id', newIds);
        if (error) {
          console.error('[leadsManagementReport] contact links (new) failed:', error);
          return;
        }
        for (const row of data || []) {
          if (row.contact_id == null || !row.newlead_id) continue;
          relations.push({ leadKey: `new:${row.newlead_id}`, contactId: Number(row.contact_id) });
        }
      })(),
    );
  }
  if (legacyIds.length > 0) {
    fetches.push(
      (async () => {
        const { data, error } = await supabase
          .from('lead_leadcontact')
          .select('contact_id, lead_id')
          .in('lead_id', legacyIds);
        if (error) {
          console.error('[leadsManagementReport] contact links (legacy) failed:', error);
          return;
        }
        for (const row of data || []) {
          if (row.contact_id == null || row.lead_id == null) continue;
          relations.push({
            leadKey: `legacy:${row.lead_id}`,
            contactId: Number(row.contact_id),
          });
        }
      })(),
    );
  }
  await Promise.all(fetches);

  if (relations.length === 0) return rows;

  const contactIds = Array.from(new Set(relations.map((r) => r.contactId)));
  const { data: contacts, error: contactsError } = await supabase
    .from('leads_contact')
    .select('id, name')
    .in('id', contactIds);
  if (contactsError) {
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

export function leadMatchesSearchQuery(row: LeadManagementLeadRow, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  if (row.leadNumber.toLowerCase().includes(q)) return true;
  if (row.clientName.toLowerCase().includes(q)) return true;
  return row.contactNames.some((name) => name.toLowerCase().includes(q));
}

/**
 * Report of all leads that have allocation data (all-time totals per lead).
 */
export async function fetchLeadsManagementReport(params: {
  employeeSearch?: string;
  category?: string | null;
} = {}): Promise<LeadManagementLeadRow[]> {
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

  const [salaryMap, clockRecords] = await Promise.all([
    fetchAverageGrossSalaryLastMonths(Array.from(employeeIds), 6),
    fetchClockInRecordsInRangeForReport(minDate, maxDate),
  ]);
  const clockMsByEmpDate = buildClockInMsByEmployeeDate(clockRecords);

  const byLead = accumulateItems({
    items,
    clockMsByEmpDate,
    salaryMap,
    employeeSearch: params.employeeSearch,
  });

  const leads = Array.from(byLead.values());
  const metas = await Promise.all(
    leads.map((lead) =>
      fetchLeadMeta({
        leadType: lead.leadType,
        newLeadId: lead.newLeadId,
        legacyLeadId: lead.legacyLeadId,
        leadNumber: lead.leadNumber,
      }),
    ),
  );

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
        employees: [],
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
    fetchClockInRecordsInRangeForReport(minDate, maxDate),
  ]);
  const clockMsByEmpDate = buildClockInMsByEmployeeDate(clockRecords);
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
