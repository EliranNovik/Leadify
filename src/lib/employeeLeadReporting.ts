import { supabase } from './supabase';
import type { RecentLead } from './recentSearchStorage';
import type { CombinedLead } from './legacyLeadsApi';
import { filterCountedClockInRecords } from './employeeClockInApproval';
import { formatDurationMs } from './employeeClockInOvertime';
import { eachDayInRange } from './employeeClockInFormat';
import { isIsraeliWeekendIso } from './employeeExtraHours';
import { fetchClockInRecordsInRange, type ClockInWithEmployee } from './workingHoursExport';
import { LEAD_ALLOCATION_HOURS_NOTE } from './employeeClockInManual';
import { fetchActiveSubEffortTitlesByLeadIdentity } from './leadSubEfforts';

export { LEAD_ALLOCATION_HOURS_NOTE };

export type LeadReportingType = 'new' | 'legacy';

export type LeadViewIdentity = {
  lead_type: LeadReportingType;
  new_lead_id: string | null;
  legacy_lead_id: number | null;
  lead_number: string;
  client_name: string;
};

export type EmployeeLeadActivityRow = {
  id: number;
  employee_id: number;
  activity_date: string;
  lead_type: LeadReportingType;
  new_lead_id: string | null;
  legacy_lead_id: number | null;
  lead_number: string;
  client_name: string;
  view_count: number;
  first_viewed_at: string;
  last_viewed_at: string;
};

export type AllocationItemInput = {
  lead_type: LeadReportingType;
  new_lead_id: string | null;
  legacy_lead_id: number | null;
  lead_number: string;
  client_name: string;
  percent: number;
};

export type EmployeeDailyAllocation = {
  id: number;
  employee_id: number;
  work_date: string;
  submitted_at: string;
  updated_at: string;
  notes: string | null;
  other_work_percent: number;
  items: AllocationItemInput[];
};

export type AllocationReportRow = {
  allocation_id: number;
  employee_id: number;
  employee_name: string;
  employee_photo_url: string | null;
  employee_min_hours: number;
  employee_hour_rate: number | null;
  department_id: number | null;
  department_name: string | null;
  work_date: string;
  submitted_at: string;
  is_other_work: boolean;
  lead_type: LeadReportingType | null;
  new_lead_id: string | null;
  legacy_lead_id: number | null;
  lead_number: string;
  client_name: string;
  percent: number;
};

export type CurrentEmployeeContext = {
  userId: string;
  employeeId: number;
  employeeName: string;
  minHours: number;
  worksFromHome: boolean;
  bonusesRole: string | null;
  isSuperUser: boolean;
};

export const OTHER_WORK_PERCENT_CAP_BASE = 30;
export const OTHER_WORK_PERCENT_CAP_OVERTIME = 10;

const JERUSALEM_TZ = 'Asia/Jerusalem';
const PERCENT_TOLERANCE = 0.01;

export function getJerusalemTodayIsoDate(date = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: JERUSALEM_TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date);
}

/** First calendar day lead allocation reporting is required (inclusive). */
export const LEAD_ALLOCATION_REPORTING_START_DATE = '2026-08-06';

export const LEAD_ALLOCATION_SAVED_EVENT = 'lead-allocation-saved';

export function isHandlerBonusesRole(role: string | null | undefined): boolean {
  return String(role || '').trim().toLowerCase() === 'h';
}

export function isDepartmentManagerBonusesRole(
  role: string | null | undefined,
): boolean {
  return String(role || '').trim().toLowerCase() === 'dm';
}

export function canAccessLeadTimeReport(params: {
  isSuperUser?: boolean | null;
  bonusesRole?: string | null;
}): boolean {
  if (params.isSuperUser === true) return true;
  return (
    isHandlerBonusesRole(params.bonusesRole) ||
    isDepartmentManagerBonusesRole(params.bonusesRole)
  );
}

export function leadTimeReportPathForDate(workDate: string): string {
  return `/lead-time-report?date=${encodeURIComponent(workDate)}`;
}

export function notifyLeadAllocationSaved(workDate?: string): void {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(
    new CustomEvent(LEAD_ALLOCATION_SAVED_EVENT, {
      detail: { workDate: workDate || null },
    }),
  );
}

/** Short label for missing-day chips, e.g. "Wed 6 Aug". */
export function formatLeadAllocationMissingDayLabel(isoDate: string): string {
  try {
    const [y, m, d] = isoDate.split('-').map(Number);
    const date = new Date(y, (m || 1) - 1, d || 1);
    return new Intl.DateTimeFormat(undefined, {
      weekday: 'short',
      day: 'numeric',
      month: 'short',
    }).format(date);
  } catch {
    return isoDate;
  }
}

/**
 * Other work max share of the day:
 * - at or below base hours → 30%
 * - above base (overtime) → 10%
 */
export function otherWorkPercentCap(
  dayWorkedMs: number,
  minHours: number,
): number {
  if (!(dayWorkedMs > 0)) return OTHER_WORK_PERCENT_CAP_BASE;
  const minMs = minHoursToMs(minHours);
  return dayWorkedMs > minMs
    ? OTHER_WORK_PERCENT_CAP_OVERTIME
    : OTHER_WORK_PERCENT_CAP_BASE;
}

export function isLeadAllocationHoursNote(notes: string | null | undefined): boolean {
  const text = notes?.trim() ?? '';
  if (!text) return false;
  return text.includes(LEAD_ALLOCATION_HOURS_NOTE);
}

function clockRecordDurationMs(
  record: { clock_in_time: string; clock_out_time: string | null },
  now = Date.now(),
): number {
  const start = new Date(record.clock_in_time).getTime();
  const end = record.clock_out_time ? new Date(record.clock_out_time).getTime() : now;
  return Math.max(0, end - start);
}

/**
 * Effective worked ms for daily lead allocation.
 * Prefer pending (or any) “Lead allocation hours” replacement session(s) for the day;
 * otherwise fall back to approved/counted clock totals.
 */
export function buildAllocationDayWorkedMs(
  records: Array<{
    employee_id?: number | null;
    clock_in_time: string;
    clock_out_time: string | null;
    notes?: string | null;
    manually?: boolean;
    approved?: boolean;
    declined?: boolean;
  }>,
  employeeId?: number | null,
): number {
  const scoped =
    employeeId == null
      ? records
      : records.filter((row) => row.employee_id === employeeId);

  const allocationSessions = scoped.filter(
    (row) =>
      row.manually === true &&
      row.declined !== true &&
      isLeadAllocationHoursNote(row.notes),
  );

  if (allocationSessions.length > 0) {
    return allocationSessions.reduce(
      (sum, row) => sum + clockRecordDurationMs(row),
      0,
    );
  }

  return filterCountedClockInRecords(scoped).reduce(
    (sum, row) => sum + clockRecordDurationMs(row),
    0,
  );
}

/** Per-employee allocation day totals (includes pending lead-allocation replacements). */
export function buildAllocationClockInMsByEmployee(
  records: Array<{
    employee_id?: number | null;
    clock_in_time: string;
    clock_out_time: string | null;
    notes?: string | null;
    manually?: boolean;
    approved?: boolean;
    declined?: boolean;
  }>,
): Map<number, number> {
  const byEmployee = new Map<number, typeof records>();
  for (const record of records) {
    const employeeId = record.employee_id;
    if (employeeId == null) continue;
    const list = byEmployee.get(employeeId);
    if (list) list.push(record);
    else byEmployee.set(employeeId, [record]);
  }

  const totals = new Map<number, number>();
  for (const [employeeId, empRecords] of byEmployee) {
    totals.set(employeeId, buildAllocationDayWorkedMs(empRecords, employeeId));
  }
  return totals;
}

export function combineWorkDateAndTime(date: string, time: string): Date {
  return new Date(`${date}T${time}`);
}

export function workIntervalDurationMs(
  workDate: string,
  fromTime: string,
  toTime: string,
): number {
  if (!workDate || !fromTime || !toTime) return 0;
  const start = combineWorkDateAndTime(workDate, fromTime).getTime();
  const end = combineWorkDateAndTime(workDate, toTime).getTime();
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return 0;
  return end - start;
}

export function leadActivityKey(identity: LeadViewIdentity): string {
  if (identity.lead_type === 'new') {
    return `new:${identity.new_lead_id}`;
  }
  return `legacy:${identity.legacy_lead_id}`;
}

function parseLegacyLeadId(raw: string | number | null | undefined): number | null {
  if (raw == null) return null;
  const text = String(raw).replace(/^legacy_/i, '').trim();
  const n = Number(text);
  return Number.isFinite(n) && n > 0 ? n : null;
}

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

export function leadViewIdentityFromRecentLead(lead: RecentLead): LeadViewIdentity | null {
  if (!lead?.id) return null;
  const clientName = lead.name?.trim() || 'Unknown';
  const leadNumber = lead.lead_number?.trim() || String(lead.id);

  if (lead.lead_type === 'legacy') {
    const legacyId = parseLegacyLeadId(lead.id);
    if (!legacyId) return null;
    return {
      lead_type: 'legacy',
      new_lead_id: null,
      legacy_lead_id: legacyId,
      lead_number: leadNumber,
      client_name: clientName,
    };
  }

  const routeId = String(lead.id).trim();
  return {
    lead_type: 'new',
    new_lead_id: isUuid(routeId) ? routeId : null,
    legacy_lead_id: null,
    lead_number: leadNumber,
    client_name: clientName,
  };
}

export function leadViewIdentityFromSelectedClient(client: {
  id?: string | number | null;
  lead_type?: string | null;
  lead_number?: string | null;
  manual_id?: string | null;
  name?: string | null;
}): LeadViewIdentity | null {
  if (!client?.id) return null;

  const isLegacy =
    client.lead_type === 'legacy' || String(client.id).startsWith('legacy_');
  const clientName = client.name?.trim() || 'Unknown';
  const leadNumber =
    client.lead_number?.trim() ||
    client.manual_id?.trim() ||
    String(client.id).replace(/^legacy_/, '');

  if (isLegacy) {
    const legacyId = parseLegacyLeadId(client.id);
    if (!legacyId) return null;
    return {
      lead_type: 'legacy',
      new_lead_id: null,
      legacy_lead_id: legacyId,
      lead_number: leadNumber,
      client_name: clientName,
    };
  }

  const idText = String(client.id).trim();
  return {
    lead_type: 'new',
    new_lead_id: isUuid(idText) ? idText : null,
    legacy_lead_id: null,
    lead_number: leadNumber,
    client_name: clientName,
  };
}

export function leadViewIdentityFromCombinedLead(lead: CombinedLead): LeadViewIdentity | null {
  if (!lead?.id) return null;
  const clientName = lead.contactName || lead.name?.trim() || 'Unknown';
  const leadNumber = lead.lead_number?.trim() || String(lead.id);

  if (lead.lead_type === 'legacy') {
    const legacyId = parseLegacyLeadId(lead.id);
    if (!legacyId) return null;
    return {
      lead_type: 'legacy',
      new_lead_id: null,
      legacy_lead_id: legacyId,
      lead_number: leadNumber,
      client_name: clientName,
    };
  }

  const idText = String(lead.id).trim();
  return {
    lead_type: 'new',
    new_lead_id: isUuid(idText) ? idText : null,
    legacy_lead_id: null,
    lead_number: leadNumber,
    client_name: clientName,
  };
}

export type ManualLeadAllocationRow = {
  key: string;
  lead_type: LeadReportingType;
  new_lead_id: string | null;
  legacy_lead_id: number | null;
  lead_number: string;
  client_name: string;
  percent: number;
  included: boolean;
  stage_id?: string | null;
  active_sub_effort_title?: string | null;
  category_main?: string | null;
  category_sub?: string | null;
};

export function allocationRowFromCombinedLead(lead: CombinedLead): ManualLeadAllocationRow | null {
  const identity = leadViewIdentityFromCombinedLead(lead);
  if (!identity) return null;
  if (identity.lead_type === 'new' && !identity.new_lead_id) return null;
  if (identity.lead_type === 'legacy' && !identity.legacy_lead_id) return null;

  return {
    key: leadActivityKey(identity),
    lead_type: identity.lead_type,
    new_lead_id: identity.new_lead_id,
    legacy_lead_id: identity.legacy_lead_id,
    lead_number: identity.lead_number,
    client_name: identity.client_name,
    percent: 0,
    included: true,
    stage_id: lead.stage != null && String(lead.stage).trim() !== '' ? String(lead.stage) : null,
  };
}

export async function fetchCurrentEmployeeContext(): Promise<CurrentEmployeeContext | null> {
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user?.id) return null;

  const { data, error } = await supabase
    .from('users')
    .select(
      `employee_id, is_superuser,
       tenants_employee!employee_id(
         display_name, min_hours, works_from_home, bonuses_role
       )`,
    )
    .eq('auth_id', user.id)
    .maybeSingle();

  if (error) throw error;
  if (!data?.employee_id) return null;

  const emp = Array.isArray(data.tenants_employee)
    ? data.tenants_employee[0]
    : data.tenants_employee;

  const isSuper =
    data.is_superuser === true ||
    data.is_superuser === 'true' ||
    data.is_superuser === 1;

  return {
    userId: user.id,
    employeeId: Number(data.employee_id),
    employeeName: emp?.display_name?.trim() || `Employee #${data.employee_id}`,
    minHours: normalizeEmployeeMinHours(emp?.min_hours),
    worksFromHome:
      emp?.works_from_home === true ||
      emp?.works_from_home === 't' ||
      emp?.works_from_home === 'true' ||
      emp?.works_from_home === 1,
    bonusesRole:
      typeof emp?.bonuses_role === 'string' ? emp.bonuses_role.trim() : null,
    isSuperUser: Boolean(isSuper),
  };
}

export async function recordEmployeeLeadView(
  identity: LeadViewIdentity,
  activityDate = getJerusalemTodayIsoDate(),
): Promise<void> {
  if (identity.lead_type === 'new' && !identity.new_lead_id) return;
  if (identity.lead_type === 'legacy' && !identity.legacy_lead_id) return;

  let leadNumber = identity.lead_number;
  // Clients may briefly set "master/?" before the sublead suffix is calculated.
  // Resolve the real display number (same sibling order as Clients.tsx) before storing.
  if (
    identity.lead_type === 'legacy' &&
    identity.legacy_lead_id != null &&
    (!leadNumber || leadNumber.includes('/?') || leadNumber.endsWith('/'))
  ) {
    try {
      const resolved = await resolveLegacyLeadDisplayNumbers([identity.legacy_lead_id]);
      leadNumber = resolved.get(identity.legacy_lead_id) || leadNumber;
    } catch (error) {
      console.warn('[employeeLeadReporting] resolve legacy lead number failed:', error);
    }
  }

  const { error } = await supabase.rpc('upsert_employee_lead_daily_activity', {
    p_activity_date: activityDate,
    p_lead_type: identity.lead_type,
    p_new_lead_id: identity.new_lead_id,
    p_legacy_lead_id: identity.legacy_lead_id,
    p_lead_number: leadNumber,
    p_client_name: identity.client_name,
  });

  if (error) {
    console.warn('[employeeLeadReporting] recordEmployeeLeadView failed:', error.message || error);
  }
}

export async function fetchDailyActivity(
  employeeId: number,
  activityDate: string,
): Promise<EmployeeLeadActivityRow[]> {
  const { data, error } = await supabase
    .from('employee_lead_daily_activity')
    .select(
      'id, employee_id, activity_date, lead_type, new_lead_id, legacy_lead_id, lead_number, client_name, view_count, first_viewed_at, last_viewed_at',
    )
    .eq('employee_id', employeeId)
    .eq('activity_date', activityDate)
    .order('last_viewed_at', { ascending: false });

  if (error) throw error;
  return (data as EmployeeLeadActivityRow[]) ?? [];
}

/** Handler Nominated / Handler Set and above — only these leads appear on daily allocation. */
export const LEAD_ALLOCATION_MIN_STAGE_ID = 105;

export function isLeadAllocationEligibleStage(stage: unknown): boolean {
  const n = Number(stage);
  return Number.isFinite(n) && n >= LEAD_ALLOCATION_MIN_STAGE_ID;
}

type LeadStageLookupIdentity = {
  lead_type: LeadReportingType;
  new_lead_id?: string | null;
  legacy_lead_id?: number | null;
};

/**
 * Resolve current stage ids for new + legacy leads in one batch.
 * Keys use the same shape as leadActivityKey identities where possible.
 */
export async function fetchLeadStagesByIdentity(
  identities: LeadStageLookupIdentity[],
): Promise<Map<string, number>> {
  const stageByKey = new Map<string, number>();
  if (identities.length === 0) return stageByKey;

  const newIds = [
    ...new Set(
      identities
        .filter((row) => row.lead_type === 'new' && row.new_lead_id)
        .map((row) => String(row.new_lead_id)),
    ),
  ];
  const legacyIds = [
    ...new Set(
      identities
        .filter((row) => row.lead_type === 'legacy' && row.legacy_lead_id != null)
        .map((row) => Number(row.legacy_lead_id))
        .filter((id) => Number.isFinite(id)),
    ),
  ];

  const [newResult, legacyResult] = await Promise.all([
    newIds.length > 0
      ? supabase.from('leads').select('id, stage').in('id', newIds)
      : Promise.resolve({ data: [] as { id: string; stage: unknown }[], error: null }),
    legacyIds.length > 0
      ? supabase.from('leads_lead').select('id, stage').in('id', legacyIds)
      : Promise.resolve({ data: [] as { id: number; stage: unknown }[], error: null }),
  ]);

  if (newResult.error) throw newResult.error;
  if (legacyResult.error) throw legacyResult.error;

  for (const row of newResult.data || []) {
    const stage = Number(row.stage);
    if (Number.isFinite(stage)) {
      stageByKey.set(`new:${row.id}`, stage);
    }
  }
  for (const row of legacyResult.data || []) {
    const stage = Number(row.stage);
    if (Number.isFinite(stage)) {
      stageByKey.set(`legacy:${row.id}`, stage);
    }
  }

  return stageByKey;
}

export type LeadCategoryDisplay = {
  main: string | null;
  sub: string | null;
};

function parseCategoryJoin(row: {
  misc_category?:
    | {
        name?: unknown;
        misc_maincategory?:
          | { name?: unknown }
          | Array<{ name?: unknown }>
          | null;
      }
    | Array<{
        name?: unknown;
        misc_maincategory?:
          | { name?: unknown }
          | Array<{ name?: unknown }>
          | null;
      }>
    | null;
}): LeadCategoryDisplay {
  const cat = Array.isArray(row.misc_category) ? row.misc_category[0] : row.misc_category;
  const sub = typeof cat?.name === 'string' ? cat.name.trim() : '';
  const mainRel = cat?.misc_maincategory;
  const mainObj = Array.isArray(mainRel) ? mainRel[0] : mainRel;
  const main = typeof mainObj?.name === 'string' ? mainObj.name.trim() : '';
  return {
    main: main || null,
    sub: sub || null,
  };
}

/** Batch-resolve main + subcategory for allocation rows. */
export async function fetchLeadCategoriesByIdentity(
  identities: LeadStageLookupIdentity[],
): Promise<Map<string, LeadCategoryDisplay>> {
  const categoryByKey = new Map<string, LeadCategoryDisplay>();
  if (identities.length === 0) return categoryByKey;

  const newIds = [
    ...new Set(
      identities
        .filter((row) => row.lead_type === 'new' && row.new_lead_id)
        .map((row) => String(row.new_lead_id)),
    ),
  ];
  const legacyIds = [
    ...new Set(
      identities
        .filter((row) => row.lead_type === 'legacy' && row.legacy_lead_id != null)
        .map((row) => Number(row.legacy_lead_id))
        .filter((id) => Number.isFinite(id)),
    ),
  ];

  const categorySelect =
    'id, category_id, misc_category!category_id(id, name, parent_id, misc_maincategory!parent_id(id, name))';
  const legacyCategorySelect =
    'id, category_id, misc_category!leads_lead_category_id_fkey(id, name, parent_id, misc_maincategory!parent_id(id, name))';

  const [newResult, legacyResult] = await Promise.all([
    newIds.length > 0
      ? supabase.from('leads').select(categorySelect).in('id', newIds)
      : Promise.resolve({ data: [] as any[], error: null }),
    legacyIds.length > 0
      ? supabase.from('leads_lead').select(legacyCategorySelect).in('id', legacyIds)
      : Promise.resolve({ data: [] as any[], error: null }),
  ]);

  // Fallback FK name used elsewhere for new leads if category_id hint fails
  let newRows = newResult.data || [];
  if (newResult.error) {
    const fallback = await supabase
      .from('leads')
      .select(
        'id, category_id, misc_category!fk_leads_category_id(id, name, parent_id, misc_maincategory!parent_id(id, name))',
      )
      .in('id', newIds);
    if (fallback.error) throw newResult.error;
    newRows = fallback.data || [];
  }
  if (legacyResult.error) throw legacyResult.error;

  for (const row of newRows) {
    categoryByKey.set(`new:${row.id}`, parseCategoryJoin(row));
  }
  for (const row of legacyResult.data || []) {
    categoryByKey.set(`legacy:${row.id}`, parseCategoryJoin(row));
  }

  return categoryByKey;
}

function leadStageLookupKey(identity: LeadStageLookupIdentity): string | null {
  if (identity.lead_type === 'new' && identity.new_lead_id) {
    return `new:${identity.new_lead_id}`;
  }
  if (identity.lead_type === 'legacy' && identity.legacy_lead_id != null) {
    return `legacy:${identity.legacy_lead_id}`;
  }
  return null;
}

/** Keep only leads currently at Handler Nominated (105) or a later stage. */
export async function filterIdentitiesByMinAllocationStage<
  T extends LeadStageLookupIdentity,
>(rows: T[], minStageId: number = LEAD_ALLOCATION_MIN_STAGE_ID): Promise<T[]> {
  if (rows.length === 0) return rows;
  const stageByKey = await fetchLeadStagesByIdentity(rows);
  return rows.filter((row) => {
    const key = leadStageLookupKey(row);
    if (!key) return false;
    const stage = stageByKey.get(key);
    return stage != null && stage >= minStageId;
  });
}

/**
 * Same suffix rules as Clients.tsx: master with no master_id = id (or id/1 when it has
 * subleads); each sublead is masterId/(index+2) ordered by id ascending.
 */
export async function resolveLegacyLeadDisplayNumbers(
  legacyIds: number[],
): Promise<Map<number, string>> {
  const result = new Map<number, string>();
  const uniqueIds = [...new Set(legacyIds.filter((id) => Number.isFinite(id) && id > 0))];
  if (uniqueIds.length === 0) return result;

  const { data: rows, error } = await supabase
    .from('leads_lead')
    .select('id, master_id, lead_number, manual_id')
    .in('id', uniqueIds);
  if (error) throw error;
  if (!rows?.length) return result;

  const masterIds = [
    ...new Set(
      rows
        .map((row) => Number(row.master_id))
        .filter((id) => Number.isFinite(id) && id > 0),
    ),
  ];

  const siblingsByMaster = new Map<number, number[]>();
  if (masterIds.length > 0) {
    const { data: siblings, error: siblingsError } = await supabase
      .from('leads_lead')
      .select('id, master_id')
      .in('master_id', masterIds)
      .not('master_id', 'is', null)
      .order('id', { ascending: true });
    if (siblingsError) throw siblingsError;
    for (const row of siblings || []) {
      const masterId = Number(row.master_id);
      const list = siblingsByMaster.get(masterId) || [];
      list.push(Number(row.id));
      siblingsByMaster.set(masterId, list);
    }
  }

  for (const row of rows) {
    const id = Number(row.id);
    const masterRaw = row.master_id;
    if (masterRaw == null || String(masterRaw).trim() === '') {
      const raw = String(row.lead_number ?? row.manual_id ?? id).trim();
      result.set(id, raw || String(id));
      continue;
    }
    const masterId = Number(masterRaw);
    const siblings = siblingsByMaster.get(masterId) || [id];
    const index = siblings.findIndex((siblingId) => siblingId === id);
    const suffix = index >= 0 ? index + 2 : siblings.length + 2;
    result.set(id, `${masterId}/${suffix}`);
  }

  return result;
}

export type AllocationLeadDisplayMeta = {
  stageId: string | null;
  lead_number: string;
  active_sub_effort_title: string | null;
  category_main: string | null;
  category_sub: string | null;
};

/** Stage + corrected display lead number (fixes legacy "master/?" placeholders). */
export async function enrichAllocationLeadDisplayMeta(
  rows: Array<{
    key?: string;
    lead_type: LeadReportingType;
    new_lead_id?: string | null;
    legacy_lead_id?: number | null;
    lead_number?: string | null;
  }>,
): Promise<Map<string, AllocationLeadDisplayMeta>> {
  const metaByKey = new Map<string, AllocationLeadDisplayMeta>();
  if (rows.length === 0) return metaByKey;

  const [stageByKey, legacyNumbers, subEffortTitles, categoriesByKey] = await Promise.all([
    fetchLeadStagesByIdentity(rows),
    resolveLegacyLeadDisplayNumbers(
      rows
        .filter((row) => row.lead_type === 'legacy' && row.legacy_lead_id != null)
        .map((row) => Number(row.legacy_lead_id)),
    ),
    fetchActiveSubEffortTitlesByLeadIdentity(supabase, rows),
    fetchLeadCategoriesByIdentity(rows),
  ]);

  for (const row of rows) {
    const lookupKey = leadStageLookupKey(row);
    const activityKey =
      row.key ||
      leadActivityKey({
        lead_type: row.lead_type,
        new_lead_id: row.new_lead_id ?? null,
        legacy_lead_id: row.legacy_lead_id ?? null,
        lead_number: row.lead_number || '',
        client_name: '',
      });
    const stageNum = lookupKey ? stageByKey.get(lookupKey) : undefined;
    let leadNumber = String(row.lead_number || '').trim();
    if (row.lead_type === 'legacy' && row.legacy_lead_id != null) {
      const resolved = legacyNumbers.get(Number(row.legacy_lead_id));
      if (resolved) leadNumber = resolved;
    }
    const category = lookupKey ? categoriesByKey.get(lookupKey) : undefined;
    metaByKey.set(activityKey, {
      stageId: stageNum != null ? String(stageNum) : null,
      lead_number: leadNumber || String(row.legacy_lead_id || row.new_lead_id || ''),
      active_sub_effort_title: lookupKey ? subEffortTitles.get(lookupKey) ?? null : null,
      category_main: category?.main ?? null,
      category_sub: category?.sub ?? null,
    });
  }

  return metaByKey;
}

export async function fetchDailyAllocation(
  employeeId: number,
  workDate: string,
): Promise<EmployeeDailyAllocation | null> {
  const { data: header, error: headerError } = await supabase
    .from('employee_daily_lead_allocations')
    .select('id, employee_id, work_date, submitted_at, updated_at, notes, other_work_percent')
    .eq('employee_id', employeeId)
    .eq('work_date', workDate)
    .maybeSingle();

  if (headerError) throw headerError;
  if (!header) return null;

  const { data: items, error: itemsError } = await supabase
    .from('employee_daily_lead_allocation_items')
    .select('lead_type, new_lead_id, legacy_lead_id, lead_number, client_name, percent')
    .eq('allocation_id', header.id)
    .order('percent', { ascending: false });

  if (itemsError) throw itemsError;

  return {
    ...(header as Omit<EmployeeDailyAllocation, 'items'>),
    other_work_percent: Number(header.other_work_percent ?? 0),
    items: (items as AllocationItemInput[]) ?? [],
  };
}

/**
 * Workdays (Sun–Thu) from the reporting start date through today that should have
 * a daily lead allocation. Weekends are skipped; start date is inclusive.
 */
export function listExpectedLeadAllocationWorkDates(
  todayIso: string = getJerusalemTodayIsoDate(),
  startIso: string = LEAD_ALLOCATION_REPORTING_START_DATE,
): string[] {
  if (!todayIso || todayIso < startIso) return [];
  return eachDayInRange(startIso, todayIso).filter((day) => !isIsraeliWeekendIso(day));
}

export async function fetchSubmittedLeadAllocationDates(
  employeeId: number,
  fromDate: string,
  toDate: string,
): Promise<Set<string>> {
  const { data, error } = await supabase
    .from('employee_daily_lead_allocations')
    .select('work_date')
    .eq('employee_id', employeeId)
    .gte('work_date', fromDate)
    .lte('work_date', toDate);

  if (error) throw error;

  return new Set(
    (data || [])
      .map((row) => String(row.work_date || '').slice(0, 10))
      .filter(Boolean),
  );
}

/** Missing allocation dates ascending (oldest → newest). Newest missing is last. */
export async function fetchMissingLeadAllocationDates(
  employeeId: number,
  options?: { todayIso?: string; startIso?: string },
): Promise<string[]> {
  const today = options?.todayIso ?? getJerusalemTodayIsoDate();
  const start = options?.startIso ?? LEAD_ALLOCATION_REPORTING_START_DATE;
  const expected = listExpectedLeadAllocationWorkDates(today, start);
  if (expected.length === 0) return [];

  const submitted = await fetchSubmittedLeadAllocationDates(
    employeeId,
    expected[0],
    expected[expected.length - 1],
  );

  return expected.filter((day) => !submitted.has(day));
}

export function latestMissingLeadAllocationDate(
  missingDates: string[],
): string | null {
  if (!missingDates.length) return null;
  return missingDates[missingDates.length - 1];
}

export function allocationPercentTotal(items: { percent: number }[]): number {
  return items.reduce((sum, row) => sum + Number(row.percent || 0), 0);
}

/** Leads-only total (excludes other work). */
export function leadAllocationPercentTotal(items: { percent: number }[]): number {
  return allocationPercentTotal(items);
}

export function dailyAllocationGrandTotal(
  leadItems: { percent: number }[],
  otherWorkPercent: number,
): number {
  return allocationPercentTotal(leadItems) + Number(otherWorkPercent || 0);
}

/** Display whole-number percent (no decimals). */
export function formatAllocationPercent(value: number): string {
  return String(Math.round(Number(value || 0)));
}

export type LeadAllocationRowState = {
  key: string;
  lead_type: LeadReportingType;
  new_lead_id: string | null;
  legacy_lead_id: number | null;
  lead_number: string;
  client_name: string;
  percent: number;
  included: boolean;
  pinned?: boolean;
  view_count?: number;
  last_viewed_at?: string;
  stage_id?: string | null;
  active_sub_effort_title?: string | null;
  category_main?: string | null;
  category_sub?: string | null;
};

export type LeadAllocationBucketsState = {
  otherWorkPercent: number;
  rows: LeadAllocationRowState[];
};

function clampAllocationPercent(value: number): number {
  return Math.max(0, Math.min(100, Number(value) || 0));
}

function normalizeAllocationPercent(value: number): number {
  return Math.round(clampAllocationPercent(value));
}

function distributeAllocationTotal(total: number, count: number): number[] {
  if (count <= 0) return [];
  const clampedTotal = Math.max(0, Math.min(100, Math.round(total)));
  if (clampedTotal === 0) return Array.from({ length: count }, () => 0);

  const base = Math.floor(clampedTotal / count);
  const values = Array.from({ length: count }, () => base);
  let remainder = clampedTotal - base * count;
  for (let i = values.length - 1; i >= 0 && remainder > 0; i -= 1) {
    values[i] += 1;
    remainder -= 1;
  }
  return values;
}

function sumIncludedLeadPercents(rows: LeadAllocationRowState[]): number {
  return rows
    .filter((row) => row.included)
    .reduce((sum, row) => sum + Number(row.percent || 0), 0);
}

function scaleLeadPercents(
  rows: LeadAllocationRowState[],
  predicate: (row: LeadAllocationRowState) => boolean,
  targetSum: number,
): LeadAllocationRowState[] {
  const targets = rows.filter((row) => row.included && predicate(row));
  if (targets.length === 0) return rows;

  const clampedTarget = Math.max(0, normalizeAllocationPercent(targetSum));
  const currentSum = targets.reduce((sum, row) => sum + row.percent, 0);

  if (clampedTarget === 0) {
    return rows.map((row) =>
      row.included && predicate(row) ? { ...row, percent: 0 } : row,
    );
  }

  if (currentSum <= 0) {
    const split = distributeAllocationTotal(clampedTarget, targets.length);
    let index = 0;
    return rows.map((row) => {
      if (!row.included || !predicate(row)) return row;
      const percent = split[index];
      index += 1;
      return { ...row, percent };
    });
  }

  const factor = clampedTarget / currentSum;
  const scaled = rows.map((row) =>
    row.included && predicate(row)
      ? { ...row, percent: Math.round(row.percent * factor) }
      : row,
  );

  const scaledSum = scaled
    .filter((row) => row.included && predicate(row))
    .reduce((sum, row) => sum + row.percent, 0);
  const drift = clampedTarget - scaledSum;
  if (drift !== 0) {
    for (let i = scaled.length - 1; i >= 0; i -= 1) {
      if (!scaled[i].included || !predicate(scaled[i])) continue;
      scaled[i] = {
        ...scaled[i],
        percent: Math.max(0, Math.min(100, scaled[i].percent + drift)),
      };
      break;
    }
  }

  return scaled;
}

function normalizeOtherWorkCap(maxOtherWorkPercent: number | undefined): number {
  return Math.max(0, Math.min(100, Math.round(Number(maxOtherWorkPercent ?? 100) || 0)));
}

/**
 * Other work may never exceed its cap, so any excess is absorbed by the included leads.
 * With no included leads there is nothing to absorb it; the page blocks saving instead.
 */
function capOtherWorkIntoLeads(
  state: LeadAllocationBucketsState,
  maxOtherWorkPercent: number,
): LeadAllocationBucketsState {
  const cap = normalizeOtherWorkCap(maxOtherWorkPercent);
  if (state.otherWorkPercent <= cap) return state;
  const hasIncluded = state.rows.some((row) => row.included);
  if (!hasIncluded) return state;

  const rows = scaleLeadPercents(state.rows, (row) => row.included, 100 - cap);
  return { otherWorkPercent: cap, rows };
}

/** Smallest total the included leads must hold so other work stays within its cap. */
export function minIncludedLeadTotalPercent(maxOtherWorkPercent: number): number {
  return 100 - normalizeOtherWorkCap(maxOtherWorkPercent);
}

/** Lowest value one lead slider may take before other work would breach its cap. */
export function minLeadAllocationPercent(
  rows: LeadAllocationRowState[],
  leadKey: string,
  maxOtherWorkPercent: number = 100,
): number {
  const hasIncluded = rows.some((row) => row.included);
  if (!hasIncluded) return 0;
  const otherIncludedSum = rows
    .filter((row) => row.included && row.key !== leadKey)
    .reduce((sum, row) => sum + row.percent, 0);
  const floor = minIncludedLeadTotalPercent(maxOtherWorkPercent) - otherIncludedSum;
  return Math.max(0, Math.min(100, Math.round(floor)));
}

/** Split flex space equally between other work and unpinned included leads. */
function rebalanceUnpinnedAndOtherWork(
  rows: LeadAllocationRowState[],
  maxOtherWorkPercent: number = 100,
): LeadAllocationBucketsState {
  const pinnedLeadSum = rows
    .filter((row) => row.included && row.pinned)
    .reduce((sum, row) => sum + row.percent, 0);
  const unpinnedIncluded = rows.filter((row) => row.included && !row.pinned);
  const flexTotal = normalizeAllocationPercent(100 - pinnedLeadSum);

  if (unpinnedIncluded.length === 0) {
    return capOtherWorkIntoLeads(
      {
        otherWorkPercent: flexTotal,
        rows: rows.map((row) => (!row.included ? { ...row, percent: 0 } : row)),
      },
      maxOtherWorkPercent,
    );
  }

  const split = distributeAllocationTotal(flexTotal, 1 + unpinnedIncluded.length);
  let unpinnedIndex = 0;
  const nextRows = rows.map((row) => {
    if (!row.included) return { ...row, percent: 0 };
    if (row.pinned) return row;
    const percent = split[1 + unpinnedIndex] ?? 0;
    unpinnedIndex += 1;
    return { ...row, percent };
  });

  return capOtherWorkIntoLeads(
    {
      otherWorkPercent: split[0] ?? 0,
      rows: nextRows,
    },
    maxOtherWorkPercent,
  );
}

/** Keep pinned lead values; flex other work to reach 100%. Shrink unpinned leads if needed. */
export function syncAllocationTo100(
  rows: LeadAllocationRowState[],
  maxOtherWorkPercent: number = 100,
): LeadAllocationBucketsState {
  const included = rows.filter((row) => row.included);
  if (included.length === 0) {
    return {
      otherWorkPercent: 100,
      rows: rows.map((row) => ({ ...row, percent: 0 })),
    };
  }

  let nextRows = rows.map((row) => (!row.included ? { ...row, percent: 0 } : row));
  let leadSum = sumIncludedLeadPercents(nextRows);
  let otherWork = normalizeAllocationPercent(100 - leadSum);

  if (otherWork >= 0) {
    return capOtherWorkIntoLeads(
      { otherWorkPercent: otherWork, rows: nextRows },
      maxOtherWorkPercent,
    );
  }

  otherWork = 0;
  const overflow = leadSum - 100;
  const unpinnedSum = nextRows
    .filter((row) => row.included && !row.pinned)
    .reduce((sum, row) => sum + row.percent, 0);

  if (unpinnedSum > 0) {
    nextRows = scaleLeadPercents(
      nextRows,
      (row) => row.included && !row.pinned,
      Math.max(0, unpinnedSum - overflow),
    );
    leadSum = sumIncludedLeadPercents(nextRows);
    otherWork = normalizeAllocationPercent(100 - leadSum);
  }

  if (otherWork < 0) {
    nextRows = scaleLeadPercents(nextRows, (row) => row.included, 100);
    otherWork = 0;
  }

  return capOtherWorkIntoLeads(
    { otherWorkPercent: otherWork, rows: nextRows },
    maxOtherWorkPercent,
  );
}

/** Highest value one lead slider may take: everything left once other work drops to 0. */
export function maxLeadAllocationPercent(
  rows: LeadAllocationRowState[],
  leadKey: string,
): number {
  const otherIncludedSum = rows
    .filter((row) => row.included && row.key !== leadKey)
    .reduce((sum, row) => sum + row.percent, 0);
  return Math.max(0, Math.min(100, Math.round(100 - otherIncludedSum)));
}

/**
 * Pin a lead percent; only other work absorbs the difference.
 * The value is clamped to the room left between other work's 0 and its cap, so dragging one
 * lead never drags the other lead rows along with it.
 */
export function setLeadAllocationPercent(
  rows: LeadAllocationRowState[],
  leadKey: string,
  nextValue: number,
  maxOtherWorkPercent: number = 100,
): LeadAllocationBucketsState {
  const target = rows.find((row) => row.key === leadKey);
  if (!target?.included) return syncAllocationTo100(rows, maxOtherWorkPercent);

  // Allow hundredths so budget "max minutes" can land between whole percents.
  const value =
    Math.round(clampAllocationPercent(nextValue) * 100) / 100;
  const otherIncludedSum = rows
    .filter((row) => row.included && row.key !== leadKey)
    .reduce((sum, row) => sum + row.percent, 0);
  const ceiling = Math.round(clampAllocationPercent(100 - otherIncludedSum) * 100) / 100;
  const floor = minLeadAllocationPercent(rows, leadKey, maxOtherWorkPercent);
  const clampedValue = Math.min(Math.max(value, Math.min(floor, ceiling)), ceiling);

  const nextRows = rows.map((row) => {
    if (!row.included) return row.percent === 0 ? row : { ...row, percent: 0 };
    if (row.key !== leadKey) return row;
    return { ...row, percent: clampedValue, pinned: true };
  });

  const otherWorkPercent = Math.min(
    normalizeOtherWorkCap(maxOtherWorkPercent),
    Math.max(0, normalizeAllocationPercent(100 - otherIncludedSum - clampedValue)),
  );
  return { otherWorkPercent, rows: nextRows };
}

/** Set other work; unpinned leads share the remaining percent. Pinned leads stay fixed. */
export function setOtherWorkAllocationPercent(
  rows: LeadAllocationRowState[],
  nextValue: number,
  maxOtherWorkPercent: number = 100,
): LeadAllocationBucketsState {
  const cappedMax = Math.max(
    0,
    Math.min(100, Math.round(Number(maxOtherWorkPercent) || 100)),
  );
  const other = Math.min(normalizeAllocationPercent(nextValue), cappedMax);
  const pinnedLeadSum = rows
    .filter((row) => row.included && row.pinned)
    .reduce((sum, row) => sum + row.percent, 0);
  const unpinnedIncluded = rows.filter((row) => row.included && !row.pinned);

  if (unpinnedIncluded.length === 0) {
    return {
      otherWorkPercent: Math.min(
        normalizeAllocationPercent(100 - pinnedLeadSum),
        cappedMax,
      ),
      rows,
    };
  }

  let remaining = normalizeAllocationPercent(100 - other - pinnedLeadSum);
  if (remaining < 0) remaining = 0;

  const split = distributeAllocationTotal(remaining, unpinnedIncluded.length);
  let index = 0;
  const nextRows = rows.map((row) => {
    if (!row.included) return { ...row, percent: 0 };
    if (row.pinned) return row;
    const percent = split[index];
    index += 1;
    return { ...row, percent };
  });

  return { otherWorkPercent: other, rows: nextRows };
}

export function toggleLeadAllocationIncluded(
  rows: LeadAllocationRowState[],
  leadKey: string,
  included: boolean,
  maxOtherWorkPercent: number = 100,
): LeadAllocationBucketsState {
  let nextRows = rows.map((row) =>
    row.key === leadKey
      ? {
          ...row,
          included,
          percent: included ? row.percent : 0,
          pinned: included ? row.pinned : false,
        }
      : row,
  );

  if (!included) {
    return syncAllocationTo100(nextRows, maxOtherWorkPercent);
  }

  nextRows = nextRows.map((row) =>
    row.key === leadKey ? { ...row, pinned: false, percent: 0 } : row,
  );
  return rebalanceUnpinnedAndOtherWork(nextRows, maxOtherWorkPercent);
}

export function addLeadToAllocationBuckets(
  rows: LeadAllocationRowState[],
  newRow: LeadAllocationRowState,
  maxOtherWorkPercent: number = 100,
): LeadAllocationBucketsState {
  const nextRows: LeadAllocationRowState[] = [
    { ...newRow, included: true, pinned: false, percent: 0 },
    ...rows,
  ];
  return rebalanceUnpinnedAndOtherWork(nextRows, maxOtherWorkPercent);
}

/** @deprecated Use rebalanceUnpinnedAndOtherWork via toggle/add flows. */
export function rebalanceFlexAllocationBuckets(
  _otherWorkPercent: number,
  _otherWorkPinned: boolean,
  rows: LeadAllocationRowState[],
  maxOtherWorkPercent: number = 100,
): LeadAllocationBucketsState {
  return rebalanceUnpinnedAndOtherWork(rows, maxOtherWorkPercent);
}

export function isAllocationPercentValid(items: { percent: number }[]): boolean {
  if (items.length === 0) return false;
  const total = allocationPercentTotal(items);
  return Math.abs(total - 100) <= PERCENT_TOLERANCE;
}

export function isDailyAllocationValid(
  leadItems: { percent: number }[],
  otherWorkPercent: number,
  maxOtherWorkPercent: number = 100,
): boolean {
  const other = Number(otherWorkPercent || 0);
  const cappedMax = Math.max(0, Math.min(100, Number(maxOtherWorkPercent) || 100));
  if (other > cappedMax + PERCENT_TOLERANCE) return false;
  const leadTotal = allocationPercentTotal(leadItems);
  const grand = leadTotal + other;
  if (Math.abs(grand - 100) > PERCENT_TOLERANCE) return false;
  if (other > 0 && leadItems.length === 0) return true;
  if (leadItems.length === 0) return false;
  return leadItems.every((item) => Number(item.percent) > 0);
}

export async function saveDailyAllocation(params: {
  employeeId: number;
  userId: string;
  workDate: string;
  items: AllocationItemInput[];
  otherWorkPercent?: number;
  notes?: string | null;
}): Promise<EmployeeDailyAllocation> {
  const otherWorkPercent = Number(params.otherWorkPercent ?? 0);
  if (!isDailyAllocationValid(params.items, otherWorkPercent)) {
    throw new Error('Leads and other work must total 100%.');
  }

  const now = new Date().toISOString();
  const { data: existing, error: existingError } = await supabase
    .from('employee_daily_lead_allocations')
    .select('id')
    .eq('employee_id', params.employeeId)
    .eq('work_date', params.workDate)
    .maybeSingle();

  if (existingError) throw existingError;

  let allocationId = existing?.id as number | undefined;

  if (allocationId) {
    const { error: updateError } = await supabase
      .from('employee_daily_lead_allocations')
      .update({
        updated_at: now,
        notes: params.notes ?? null,
        other_work_percent: Number(otherWorkPercent.toFixed(2)),
      })
      .eq('id', allocationId);

    if (updateError) throw updateError;

    const { error: deleteError } = await supabase
      .from('employee_daily_lead_allocation_items')
      .delete()
      .eq('allocation_id', allocationId);

    if (deleteError) throw deleteError;
  } else {
    const { data: inserted, error: insertError } = await supabase
      .from('employee_daily_lead_allocations')
      .insert({
        employee_id: params.employeeId,
        user_id: params.userId,
        work_date: params.workDate,
        submitted_at: now,
        updated_at: now,
        notes: params.notes ?? null,
        other_work_percent: Number(otherWorkPercent.toFixed(2)),
      })
      .select('id')
      .single();

    if (insertError) throw insertError;
    allocationId = inserted.id as number;
  }

  const rows = params.items.map((item) => ({
    allocation_id: allocationId,
    lead_type: item.lead_type,
    new_lead_id: item.new_lead_id,
    legacy_lead_id: item.legacy_lead_id,
    lead_number: item.lead_number,
    client_name: item.client_name,
    percent: Number(item.percent.toFixed(2)),
  }));

  if (rows.length > 0) {
    const { error: itemsError } = await supabase
      .from('employee_daily_lead_allocation_items')
      .insert(rows);

    if (itemsError) throw itemsError;
  }

  const saved = await fetchDailyAllocation(params.employeeId, params.workDate);
  if (!saved) {
    throw new Error('Failed to load saved allocation.');
  }
  return saved;
}

/** Delete the day's allocation so it returns to the unsaved / null default state. */
export async function deleteDailyAllocation(
  employeeId: number,
  workDate: string,
): Promise<void> {
  const { error } = await supabase
    .from('employee_daily_lead_allocations')
    .delete()
    .eq('employee_id', employeeId)
    .eq('work_date', workDate);

  if (error) throw error;
}

export async function fetchAllocationReport(params: {
  fromDate: string;
  toDate: string;
  departmentId?: number | null;
  employeeSearch?: string;
}): Promise<AllocationReportRow[]> {
  let allocationQuery = supabase
    .from('employee_daily_lead_allocations')
    .select(
      `
      id,
      employee_id,
      work_date,
      submitted_at,
      other_work_percent,
      tenants_employee!employee_id (
        id,
        display_name,
        photo_url,
        photo,
        min_hours,
        hour_rate,
        department_id,
        tenant_departement!department_id (
          id,
          name
        )
      ),
      employee_daily_lead_allocation_items (
        lead_type,
        new_lead_id,
        legacy_lead_id,
        lead_number,
        client_name,
        percent
      )
    `,
    )
    .gte('work_date', params.fromDate)
    .lte('work_date', params.toDate)
    .order('work_date', { ascending: false });

  const { data, error } = await allocationQuery;
  if (error) throw error;

  const search = params.employeeSearch?.trim().toLowerCase() || '';
  const departmentId = params.departmentId ?? null;

  const rows: AllocationReportRow[] = [];

  for (const alloc of data || []) {
    const emp = Array.isArray(alloc.tenants_employee)
      ? alloc.tenants_employee[0]
      : alloc.tenants_employee;
    if (!emp) continue;

    const dept = Array.isArray(emp.tenant_departement)
      ? emp.tenant_departement[0]
      : emp.tenant_departement;

    const employeeName = emp.display_name?.trim() || `Employee #${emp.id}`;
    const employeePhotoUrl =
      (typeof emp.photo_url === 'string' && emp.photo_url.trim()) ||
      (typeof emp.photo === 'string' && emp.photo.trim()) ||
      null;
    const employeeMinHours = normalizeEmployeeMinHours(emp.min_hours);
    const employeeHourRate = normalizeEmployeeHourRate(emp.hour_rate);
    if (search && !employeeName.toLowerCase().includes(search)) continue;
    if (departmentId != null && Number(emp.department_id) !== departmentId) continue;

    const items = Array.isArray(alloc.employee_daily_lead_allocation_items)
      ? alloc.employee_daily_lead_allocation_items
      : alloc.employee_daily_lead_allocation_items
        ? [alloc.employee_daily_lead_allocation_items]
        : [];

    const otherWorkPercent = Number(alloc.other_work_percent ?? 0);
    if (otherWorkPercent > 0) {
      rows.push({
        allocation_id: alloc.id,
        employee_id: alloc.employee_id,
        employee_name: employeeName,
        employee_photo_url: employeePhotoUrl,
        employee_min_hours: employeeMinHours,
        employee_hour_rate: employeeHourRate,
        department_id: emp.department_id ?? null,
        department_name: dept?.name ?? null,
        work_date: alloc.work_date,
        submitted_at: alloc.submitted_at,
        is_other_work: true,
        lead_type: null,
        new_lead_id: null,
        legacy_lead_id: null,
        lead_number: '—',
        client_name: 'Other work',
        percent: otherWorkPercent,
      });
    }

    for (const item of items) {
      rows.push({
        allocation_id: alloc.id,
        employee_id: alloc.employee_id,
        employee_name: employeeName,
        employee_photo_url: employeePhotoUrl,
        employee_min_hours: employeeMinHours,
        employee_hour_rate: employeeHourRate,
        department_id: emp.department_id ?? null,
        department_name: dept?.name ?? null,
        work_date: alloc.work_date,
        submitted_at: alloc.submitted_at,
        is_other_work: false,
        lead_type: item.lead_type,
        new_lead_id: item.new_lead_id,
        legacy_lead_id: item.legacy_lead_id,
        lead_number: item.lead_number,
        client_name: item.client_name,
        percent: Number(item.percent),
      });
    }
  }

  rows.sort((a, b) => {
    const dateCmp = b.work_date.localeCompare(a.work_date);
    if (dateCmp !== 0) return dateCmp;
    const nameCmp = a.employee_name.localeCompare(b.employee_name, undefined, {
      sensitivity: 'base',
    });
    if (nameCmp !== 0) return nameCmp;
    return b.percent - a.percent;
  });

  return rows;
}

export async function fetchDepartmentsForFilter(): Promise<{ id: number; name: string }[]> {
  const { data, error } = await supabase
    .from('tenant_departement')
    .select('id, name')
    .order('name', { ascending: true });

  if (error) throw error;

  return (data || [])
    .map((row: { id: number; name: string | null }) => ({
      id: row.id,
      name: row.name?.trim() || `Department #${row.id}`,
    }))
    .filter((row) => row.id != null);
}

export function buildClientRouteFromAllocationRow(row: {
  is_other_work?: boolean;
  lead_type: LeadReportingType | null;
  lead_number: string;
  legacy_lead_id: number | null;
}): string | null {
  if (row.is_other_work) return null;
  if (row.lead_type === 'legacy' && row.legacy_lead_id != null) {
    const leadNumber = String(row.lead_number || '').trim();
    // Match Clients.tsx: legacy subleads use ?lead= for the display number.
    if (leadNumber.includes('/')) {
      return `/clients/${encodeURIComponent(String(row.legacy_lead_id))}?lead=${encodeURIComponent(leadNumber)}`;
    }
    return `/clients/${encodeURIComponent(String(row.legacy_lead_id))}`;
  }
  return `/clients/${encodeURIComponent(row.lead_number)}`;
}

/** Split 100% equally across n integer buckets (last items absorb remainder). */
export function equalSplitPercents(count: number): number[] {
  return distributeAllocationTotal(100, count);
}

/** When one slider changes, scale other included leads to fill remaining percent. */
export function redistributePercents(
  percents: number[],
  changedIndex: number,
  nextValue: number,
): number[] {
  if (percents.length === 0) return [];
  if (percents.length === 1) return [100];

  const clamped = Math.max(0, Math.min(100, nextValue));
  const result = [...percents];
  result[changedIndex] = clamped;

  const otherIndexes = result.map((_, i) => i).filter((i) => i !== changedIndex);
  const remaining = 100 - clamped;
  const otherTotal = otherIndexes.reduce((sum, i) => sum + result[i], 0);

  if (otherIndexes.length === 0) {
    result[changedIndex] = 100;
    return result;
  }

  if (otherTotal <= 0) {
    const split = equalSplitPercents(otherIndexes.length);
    otherIndexes.forEach((idx, i) => {
      result[idx] = split[i];
    });
    return result.map((v) => Math.round(v * 100) / 100);
  }

  otherIndexes.forEach((idx) => {
    result[idx] = Math.round(((result[idx] / otherTotal) * remaining) * 100) / 100;
  });

  const drift = 100 - result.reduce((sum, v) => sum + v, 0);
  if (Math.abs(drift) > 0.001) {
    const lastOther = otherIndexes[otherIndexes.length - 1];
    result[lastOther] = Math.round((result[lastOther] + drift) * 100) / 100;
  }

  return result;
}

export function formatAllocationWorkedDuration(ms: number): string {
  return formatDurationMs(Math.max(0, ms));
}

export const DEFAULT_EMPLOYEE_MIN_HOURS = 8;

export function normalizeEmployeeMinHours(value: unknown): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) return DEFAULT_EMPLOYEE_MIN_HOURS;
  return parsed;
}

export function minHoursToMs(hours: number): number {
  return Math.round(normalizeEmployeeMinHours(hours) * 60 * 60 * 1000);
}

export type WorkedHoursVsMinComparison = {
  status: 'below' | 'above' | 'met';
  differenceMs: number;
  minHours: number;
};

export function compareWorkedHoursToMin(
  totalWorkedMs: number,
  minHours: number,
): WorkedHoursVsMinComparison {
  const minMs = minHoursToMs(minHours);
  const workedMs = Math.max(0, totalWorkedMs);
  const normalizedMinHours = normalizeEmployeeMinHours(minHours);

  if (workedMs < minMs) {
    return {
      status: 'below',
      differenceMs: minMs - workedMs,
      minHours: normalizedMinHours,
    };
  }

  if (workedMs > minMs) {
    return {
      status: 'above',
      differenceMs: workedMs - minMs,
      minHours: normalizedMinHours,
    };
  }

  return {
    status: 'met',
    differenceMs: 0,
    minHours: normalizedMinHours,
  };
}

export function formatWorkedHoursDifferenceLabel(
  comparison: WorkedHoursVsMinComparison,
): string {
  if (comparison.status === 'met') {
    return `Minimum met (${comparison.minHours}h)`;
  }

  const prefix = comparison.status === 'below' ? '−' : '+';
  const direction = comparison.status === 'below' ? 'below' : 'above';
  return `${prefix}${formatAllocationWorkedDuration(comparison.differenceMs)} ${direction} minimum (${comparison.minHours}h)`;
}

export function allocationPercentToWorkedMs(totalWorkedMs: number, percent: number): number {
  const safeTotal = Math.max(0, totalWorkedMs);
  const safePercent = Math.max(0, Math.min(100, Number(percent) || 0));
  return Math.round((safeTotal * safePercent) / 100);
}

export function normalizeEmployeeHourRate(value: unknown): number | null {
  if (value == null || value === '') return null;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) return null;
  return parsed;
}

export const OVERTIME_HOUR_RATE_MULTIPLIER = 1.25;

export function workedMsToBillableHours(
  workedMs: number,
  minHours?: number | null,
): number {
  const hours = Math.max(0, workedMs) / (1000 * 60 * 60);
  if (minHours == null) return hours;

  const minHoursNum = normalizeEmployeeMinHours(minHours);
  const regularHours = Math.min(hours, minHoursNum);
  const overtimeHours = Math.max(0, hours - minHoursNum);
  return regularHours + overtimeHours * OVERTIME_HOUR_RATE_MULTIPLIER;
}

export function workedMsToCostNis(
  workedMs: number,
  hourRate: number | null,
  minHours?: number | null,
): number | null {
  if (hourRate == null) return null;
  const billableHours = workedMsToBillableHours(workedMs, minHours);
  return Math.round(hourRate * billableHours * 100) / 100;
}

/** Fixed monthly hours used to derive salary → hourly rate (avg monthly salary ÷ this). */
export const SALARY_COST_HOURS_PER_MONTH = 127;

/**
 * @deprecated Hourly rate now uses {@link SALARY_COST_HOURS_PER_MONTH} (127), not min_hours × days.
 * Kept for any legacy imports.
 */
export const SALARY_COST_WORKING_DAYS_PER_MONTH = 22;

/**
 * Hourly rate from average monthly salary: salary ÷ {@link SALARY_COST_HOURS_PER_MONTH}.
 * `minHours` is ignored (kept for call-site compatibility with older min_hours-based formula).
 */
export function salaryToHourlyRateNis(
  avgMonthlySalaryNis: number | null | undefined,
  _minHours?: number,
  hoursPerMonth: number = SALARY_COST_HOURS_PER_MONTH,
): number | null {
  if (avgMonthlySalaryNis == null || !Number.isFinite(avgMonthlySalaryNis) || avgMonthlySalaryNis <= 0) {
    return null;
  }
  const monthlyHours =
    Number.isFinite(hoursPerMonth) && hoursPerMonth > 0
      ? hoursPerMonth
      : SALARY_COST_HOURS_PER_MONTH;
  return Math.round((avgMonthlySalaryNis / monthlyHours) * 100) / 100;
}

/** Lead/row cost as a percent of average monthly salary (total cost = salary). */
export function salaryPercentToCostNis(
  avgMonthlySalaryNis: number | null | undefined,
  percent: number,
): number | null {
  if (avgMonthlySalaryNis == null || !Number.isFinite(avgMonthlySalaryNis)) return null;
  const safePercent = Math.max(0, Math.min(100, Number(percent) || 0));
  return Math.round(((avgMonthlySalaryNis * safePercent) / 100) * 100) / 100;
}

/** Row cost from allocated worked time × derived salary hourly rate (no overtime markup). */
export function workedMsAtHourlyRateToCostNis(
  workedMs: number,
  hourRateNis: number | null | undefined,
): number | null {
  if (hourRateNis == null || !Number.isFinite(hourRateNis)) return null;
  const hours = Math.max(0, workedMs) / (1000 * 60 * 60);
  return Math.round(hours * hourRateNis * 100) / 100;
}

export function allocationPercentToCostNis(
  totalWorkedMs: number,
  percent: number,
  hourRate: number | null,
  minHours: number,
): number | null {
  const totalCostNis = workedMsToCostNis(totalWorkedMs, hourRate, minHours);
  if (totalCostNis == null) return null;
  const safePercent = Math.max(0, Math.min(100, Number(percent) || 0));
  return Math.round((totalCostNis * safePercent) / 100 * 100) / 100;
}

export function formatAllocationCostNis(amount: number | null | undefined): string {
  if (amount == null || !Number.isFinite(amount)) return '—';
  return new Intl.NumberFormat('he-IL', {
    style: 'currency',
    currency: 'ILS',
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  }).format(amount);
}

/** Total counted clock-in milliseconds per employee for a single calendar day. */
export function buildDailyClockInMsByEmployee(
  records: ClockInWithEmployee[],
): Map<number, number> {
  const counted = filterCountedClockInRecords(records);
  const totals = new Map<number, number>();
  const now = Date.now();

  for (const record of counted) {
    const employeeId = record.employee_id;
    if (employeeId == null) continue;
    const start = new Date(record.clock_in_time).getTime();
    const end = record.clock_out_time ? new Date(record.clock_out_time).getTime() : now;
    const durationMs = Math.max(0, end - start);
    totals.set(employeeId, (totals.get(employeeId) ?? 0) + durationMs);
  }

  return totals;
}

export type ClockedOutEmployeeRef = {
  employeeId: number;
  employeeName: string;
  departmentId: number | null;
  departmentName: string | null;
  photoUrl: string | null;
  minHours: number;
  hourRate: number | null;
};

function resolveClockInEmployee(record: ClockInWithEmployee): {
  employeeName: string;
  departmentId: number | null;
  departmentName: string | null;
  photoUrl: string | null;
  minHours: number;
  hourRate: number | null;
} {
  const emp = Array.isArray(record.tenants_employee)
    ? record.tenants_employee[0]
    : record.tenants_employee;
  const employeeId = record.employee_id ?? 0;
  const dept = Array.isArray(emp?.tenant_departement)
    ? emp.tenant_departement[0]
    : emp?.tenant_departement;

  return {
    employeeName: emp?.display_name?.trim() || `Employee #${employeeId}`,
    departmentId: emp?.department_id ?? null,
    departmentName: dept?.name?.trim() || null,
    photoUrl: emp?.photo_url?.trim() || null,
    minHours: normalizeEmployeeMinHours(emp?.min_hours),
    hourRate: normalizeEmployeeHourRate(emp?.hour_rate),
  };
}

/** Employees with at least one approved clock-in/out session on the day. */
export function collectClockedOutEmployeesForDay(
  records: ClockInWithEmployee[],
): Map<number, ClockedOutEmployeeRef> {
  const counted = filterCountedClockInRecords(records);
  const map = new Map<number, ClockedOutEmployeeRef>();

  for (const record of counted) {
    const employeeId = record.employee_id;
    if (employeeId == null || !record.clock_out_time) continue;
    if (map.has(employeeId)) continue;

    const { employeeName, departmentId, departmentName, photoUrl, minHours, hourRate } =
      resolveClockInEmployee(record);
    map.set(employeeId, {
      employeeId,
      employeeName,
      departmentId,
      departmentName,
      photoUrl,
      minHours,
      hourRate,
    });
  }

  return map;
}

export async function fetchSubmittedAllocationEmployeeIds(
  workDate: string,
): Promise<Set<number>> {
  const { data, error } = await supabase
    .from('employee_daily_lead_allocations')
    .select('employee_id')
    .eq('work_date', workDate);

  if (error) throw error;

  return new Set(
    (data || [])
      .map((row: { employee_id: number }) => row.employee_id)
      .filter((id) => id != null),
  );
}

export type MissingLeadReportingEmployee = ClockedOutEmployeeRef & {
  workedMs: number;
  costNis: number | null;
};

export function listMissingLeadReportingEmployees(params: {
  clockedOutEmployees: Map<number, ClockedOutEmployeeRef>;
  reportedEmployeeIds: Set<number>;
  clockInMsByEmployee: Map<number, number>;
  departmentId?: number | null;
  employeeSearch?: string;
  /** Average monthly gross salary (last 6 months). Total cost = salary when provided. */
  avgMonthlySalaryByEmployee?: Map<number, number>;
}): MissingLeadReportingEmployee[] {
  const search = params.employeeSearch?.trim().toLowerCase() || '';
  const departmentId = params.departmentId ?? null;
  const rows: MissingLeadReportingEmployee[] = [];

  for (const employee of params.clockedOutEmployees.values()) {
    if (departmentId != null && employee.departmentId !== departmentId) continue;
    if (search && !employee.employeeName.toLowerCase().includes(search)) continue;
    if (params.reportedEmployeeIds.has(employee.employeeId)) continue;

    const workedMs = params.clockInMsByEmployee.get(employee.employeeId) ?? 0;
    const avgSalary = params.avgMonthlySalaryByEmployee?.get(employee.employeeId);
    const costNis =
      avgSalary != null && Number.isFinite(avgSalary) && avgSalary > 0
        ? Math.round(avgSalary * 100) / 100
        : workedMsToCostNis(workedMs, employee.hourRate, employee.minHours);
    rows.push({
      ...employee,
      workedMs,
      costNis,
    });
  }

  return rows.sort((a, b) => a.employeeName.localeCompare(b.employeeName));
}

export function countMissingLeadReporting(params: {
  clockedOutEmployees: Map<number, ClockedOutEmployeeRef>;
  reportedEmployeeIds: Set<number>;
  departmentId?: number | null;
  employeeSearch?: string;
}): number {
  return listMissingLeadReportingEmployees({
    ...params,
    clockInMsByEmployee: new Map(),
  }).length;
}

export async function fetchDailyClockInMsByEmployee(
  workDate: string,
): Promise<Map<number, number>> {
  const records = await fetchClockInRecordsInRange(workDate, workDate);
  return buildDailyClockInMsByEmployee(records);
}

/** Allocation-aware day totals (pending lead-allocation replacements count). */
export async function fetchAllocationClockInMsByEmployee(
  workDate: string,
): Promise<Map<number, number>> {
  const records = await fetchClockInRecordsInRange(workDate, workDate);
  return buildAllocationClockInMsByEmployee(records);
}
