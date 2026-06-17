import { supabase } from './supabase';
import { dateRangeToIsoBounds } from './employeeClockInFormat';
import { resolveWorkplaceName } from './clockInLocations';

export type ClockInApprovalStatus = 'approved' | 'pending' | 'declined';

export type ClockInApprovalFields = {
  manually?: boolean;
  approved?: boolean;
  declined?: boolean;
  approved_by?: string | null;
  approved_at?: string | null;
};

export type ManualClockInApprovalRecord = {
  id: number;
  employee_id: number;
  clock_in_time: string;
  clock_out_time: string | null;
  notes: string | null;
  manually: boolean;
  approved: boolean;
  declined: boolean;
  approved_by: string | null;
  approved_at: string | null;
  clock_in_location_id?: number | null;
  clock_out_location_id?: number | null;
  clock_in_place?: { name: string } | { name: string }[] | null;
  clock_out_place?: { name: string } | { name: string }[] | null;
  location_latitude?: number | null;
  location_longitude?: number | null;
  location_address?: string | null;
  location_city?: string | null;
  location_country?: string | null;
  clock_out_location_latitude?: number | null;
  clock_out_location_longitude?: number | null;
  clock_out_location_address?: string | null;
  clock_out_location_city?: string | null;
  clock_out_location_country?: string | null;
  employee_name?: string;
  employee_department?: string;
  employee_photo_url?: string | null;
  employee_email?: string | null;
  employee_phone?: string | null;
  employee_mobile?: string | null;
  employee_chat_user_id?: string | null;
};

const MANUAL_APPROVAL_SELECT = `
  id, employee_id, clock_in_time, clock_out_time, notes, manually,
  approved, declined, approved_by, approved_at,
  clock_in_location_id, clock_out_location_id,
  clock_in_place:clock_in_locations!clock_in_location_id ( name ),
  clock_out_place:clock_in_locations!clock_out_location_id ( name ),
  location_latitude, location_longitude, location_address, location_city, location_country,
  clock_out_location_latitude, clock_out_location_longitude,
  clock_out_location_address, clock_out_location_city, clock_out_location_country
`;

export function isManualClockInRecord(record: ClockInApprovalFields): boolean {
  return record.manually === true;
}

/** Manual entries need explicit approval; automatic entries are always approved. */
export function getClockInApprovalStatus(
  record: ClockInApprovalFields,
): ClockInApprovalStatus {
  if (record.declined === true) return 'declined';
  if (!isManualClockInRecord(record)) return 'approved';
  if (record.approved === true) return 'approved';
  return 'pending';
}

export function isClockInRecordCounted(record: ClockInApprovalFields): boolean {
  return getClockInApprovalStatus(record) === 'approved';
}

export function getDayClockInApprovalStatus(
  records: ClockInApprovalFields[],
  options?: { hasManualClockSummary?: boolean },
): ClockInApprovalStatus {
  if (records.length > 0) {
    const statuses = records.map(getClockInApprovalStatus);
    if (statuses.includes('declined')) return 'declined';
    if (statuses.includes('pending')) return 'pending';
    return 'approved';
  }
  if (options?.hasManualClockSummary) return 'pending';
  return 'approved';
}

export function clockInApprovalRowClass(status: ClockInApprovalStatus): string {
  if (status === 'declined') return 'approval-row-declined';
  return '';
}

export function clockInApprovalWatermarkLabel(status: ClockInApprovalStatus): string | null {
  if (status === 'pending') return 'Waiting for approval';
  if (status === 'declined') return 'Declined';
  if (status === 'approved') return 'Approved';
  return null;
}

export function clockInApprovalLabelClass(status: ClockInApprovalStatus): string {
  if (status === 'pending') return 'text-sky-700';
  if (status === 'declined') return 'text-red-700';
  if (status === 'approved') return 'text-emerald-700';
  return '';
}

export type ClockInApprovalBlockers = {
  pendingCount: number;
  declinedCount: number;
};

export function countClockInApprovalBlockers(
  records: ClockInApprovalFields[],
): ClockInApprovalBlockers {
  let pendingCount = 0;
  let declinedCount = 0;
  for (const record of records) {
    if (!isManualClockInRecord(record)) continue;
    const status = getClockInApprovalStatus(record);
    if (status === 'pending') pendingCount += 1;
    else if (status === 'declined') declinedCount += 1;
  }
  return { pendingCount, declinedCount };
}

export function hasClockInApprovalBlockers(records: ClockInApprovalFields[]): boolean {
  const { pendingCount, declinedCount } = countClockInApprovalBlockers(records);
  return pendingCount > 0 || declinedCount > 0;
}

export function clockInApprovalSubmitBlockMessage(
  blockers: ClockInApprovalBlockers,
): string | null {
  const { pendingCount, declinedCount } = blockers;
  if (pendingCount === 0 && declinedCount === 0) return null;
  const parts: string[] = [];
  if (pendingCount > 0) parts.push(`${pendingCount} awaiting approval`);
  if (declinedCount > 0) parts.push(`${declinedCount} declined`);
  return parts.join(', ');
}

export function filterCountedClockInRecords<T extends ClockInApprovalFields>(records: T[]): T[] {
  return records.filter(isClockInRecordCounted);
}

/** Coerce DB row booleans — manual entries default to pending when approval columns are absent. */
export function normalizeClockInApprovalFields<
  T extends ClockInApprovalFields & { manually?: boolean | null },
>(record: T): T {
  const manually = record.manually === true;
  return {
    ...record,
    manually,
    approved: record.approved === true,
    declined: record.declined === true,
  };
}

export const HOME_WFH_APPROVAL_NOTE = 'Home access — waiting for approval';

/** Legacy note text from earlier builds — still matched for display/filtering. */
const HOME_WFH_APPROVAL_NOTE_LEGACY = 'Work from home access — waiting for admin approval';

export function isHomeWfhApprovalRequest(record: { notes?: string | null }): boolean {
  const notes = record.notes?.trim() ?? '';
  if (!notes) return false;
  return (
    notes.includes(HOME_WFH_APPROVAL_NOTE)
    || notes.includes(HOME_WFH_APPROVAL_NOTE_LEGACY)
    || notes.toLowerCase().includes('work from home access')
  );
}

export function homeWfhApprovalNotesFilter(): string {
  return `notes.ilike.%Home access%,notes.ilike.%Work from home access%`;
}

export async function fetchPendingHomeWfhApproval(employeeId: number): Promise<boolean> {
  const { count, error } = await supabase
    .from('employee_clock_in')
    .select('id', { count: 'exact', head: true })
    .eq('employee_id', employeeId)
    .eq('manually', true)
    .eq('approved', false)
    .eq('declined', false)
    .or(homeWfhApprovalNotesFilter());

  if (error) throw error;
  return (count ?? 0) > 0;
}

export async function insertHomeWfhApprovalRequest(
  employeeId: number,
  userId: string,
  homeLocationId: number,
): Promise<void> {
  const now = new Date().toISOString();
  const row: Record<string, unknown> = {
    employee_id: employeeId,
    user_id: userId,
    clock_in_time: now,
    clock_out_time: null,
    clock_in_location_id: homeLocationId,
    notes: HOME_WFH_APPROVAL_NOTE,
    is_active: false,
    manually: true,
    approved: false,
    declined: false,
    location_source: 'manual',
  };

  let { error } = await supabase.from('employee_clock_in').insert(row);
  if (error && row.clock_in_location_id) {
    const { clock_in_location_id: _drop, ...withoutPreset } = row;
    const retry = await supabase.from('employee_clock_in').insert(withoutPreset);
    error = retry.error;
  }
  if (error) throw error;
}

export async function fetchPendingManualClockInCount(): Promise<number> {
  const { count, error } = await supabase
    .from('employee_clock_in')
    .select('id', { count: 'exact', head: true })
    .eq('manually', true)
    .eq('approved', false)
    .eq('declined', false);

  if (error) throw error;
  return count ?? 0;
}

export async function fetchManualClockInsForApproval(
  employeeId: number,
  year: number,
  month: number,
): Promise<ManualClockInApprovalRecord[]> {
  const monthStr = String(month).padStart(2, '0');
  const lastDay = new Date(year, month, 0).getDate();
  const dateFrom = `${year}-${monthStr}-01`;
  const dateTo = `${year}-${monthStr}-${String(lastDay).padStart(2, '0')}`;
  const { start, end } = dateRangeToIsoBounds(dateFrom, dateTo);

  const { data, error } = await supabase
    .from('employee_clock_in')
    .select(MANUAL_APPROVAL_SELECT)
    .eq('employee_id', employeeId)
    .eq('manually', true)
    .gte('clock_in_time', start)
    .lte('clock_in_time', end)
    .order('clock_in_time', { ascending: true });

  if (error) throw error;
  return ((data as ManualClockInApprovalRecord[]) || []).map(normalizeClockInApprovalFields);
}

type ManualClockInApprovalRow = ManualClockInApprovalRecord & {
  tenants_employee?:
    | {
        display_name: string | null;
        photo_url?: string | null;
        photo?: string | null;
        phone?: string | null;
        mobile?: string | null;
        tenant_departement?: { name: string } | { name: string }[] | null;
      }
    | Array<{
        display_name: string | null;
        photo_url?: string | null;
        photo?: string | null;
        phone?: string | null;
        mobile?: string | null;
        tenant_departement?: { name: string } | { name: string }[] | null;
      }>
    | null;
};

function mapManualClockInApprovalRows(rows: ManualClockInApprovalRow[]): ManualClockInApprovalRecord[] {
  return rows.map((row) => {
    const te = Array.isArray(row.tenants_employee) ? row.tenants_employee[0] : row.tenants_employee;
    const dept = Array.isArray(te?.tenant_departement)
      ? te?.tenant_departement[0]
      : te?.tenant_departement;
    const normalized = normalizeClockInApprovalFields(row);
    return {
      ...normalized,
      employee_name: te?.display_name?.trim() || `Employee #${row.employee_id}`,
      employee_department: dept?.name || '—',
      employee_photo_url:
        (typeof te?.photo_url === 'string' && te.photo_url.trim()) ||
        (typeof te?.photo === 'string' && te.photo.trim()) ||
        null,
      employee_phone: te?.phone?.trim() || null,
      employee_mobile: te?.mobile?.trim() || null,
    };
  });
}

async function enrichManualApprovalRowsWithContacts(
  rows: ManualClockInApprovalRecord[],
): Promise<ManualClockInApprovalRecord[]> {
  const employeeIds = [...new Set(rows.map((row) => row.employee_id))];
  if (employeeIds.length === 0) return rows;

  const { data: users, error } = await supabase
    .from('users')
    .select('id, email, employee_id')
    .in('employee_id', employeeIds);

  if (error) throw error;

  const userByEmployeeId = new Map<number, { id: string; email: string | null }>();
  for (const user of users || []) {
    if (user.employee_id == null) continue;
    userByEmployeeId.set(user.employee_id, {
      id: user.id,
      email: user.email ?? null,
    });
  }

  return rows.map((row) => {
    const linkedUser = userByEmployeeId.get(row.employee_id);
    return {
      ...row,
      employee_email: linkedUser?.email ?? row.employee_email ?? null,
      employee_chat_user_id: linkedUser?.id ?? null,
    };
  });
}

const MANUAL_APPROVAL_WITH_EMPLOYEE_SELECT = `
  ${MANUAL_APPROVAL_SELECT},
  tenants_employee!employee_id (
    display_name,
    photo_url,
    photo,
    phone,
    mobile,
    tenant_departement!department_id ( name )
  )
`;

/** Pending + declined manual entries for one calendar month. */
export async function fetchAllManualClockInsForApproval(
  year: number,
  month: number,
): Promise<ManualClockInApprovalRecord[]> {
  const monthStr = String(month).padStart(2, '0');
  const lastDay = new Date(year, month, 0).getDate();
  const dateFrom = `${year}-${monthStr}-01`;
  const dateTo = `${year}-${monthStr}-${String(lastDay).padStart(2, '0')}`;
  const { start, end } = dateRangeToIsoBounds(dateFrom, dateTo);

  const { data, error } = await supabase
    .from('employee_clock_in')
    .select(MANUAL_APPROVAL_WITH_EMPLOYEE_SELECT)
    .eq('manually', true)
    .gte('clock_in_time', start)
    .lte('clock_in_time', end)
    .order('clock_in_time', { ascending: true });

  if (error) throw error;
  const mapped = mapManualClockInApprovalRows((data || []) as ManualClockInApprovalRow[]);
  return enrichManualApprovalRowsWithContacts(mapped);
}

/** All pending + declined manual entries (any date). */
export async function fetchAllUnapprovedManualClockInsForApproval(): Promise<ManualClockInApprovalRecord[]> {
  const { data, error } = await supabase
    .from('employee_clock_in')
    .select(MANUAL_APPROVAL_WITH_EMPLOYEE_SELECT)
    .eq('manually', true)
    .eq('approved', false)
    .order('clock_in_time', { ascending: true });

  if (error) throw error;
  const mapped = mapManualClockInApprovalRows((data || []) as ManualClockInApprovalRow[]);
  return enrichManualApprovalRowsWithContacts(mapped);
}

export async function approveClockInRecord(
  recordId: number,
  approverAuthUserId: string,
): Promise<void> {
  // Fetch employee, notes, and workplace so we can handle WFH requests and auto-enable works_from_home.
  const { data: existing, error: fetchError } = await supabase
    .from('employee_clock_in')
    .select(
      `id, employee_id, notes,
       clock_in_location_id,
       clock_out_location_id,
       clock_in_place:clock_in_locations!clock_in_location_id ( name, slug ),
       clock_out_place:clock_in_locations!clock_out_location_id ( name, slug )`,
    )
    .eq('id', recordId)
    .maybeSingle();

  if (fetchError) throw fetchError;

  // WFH approval requests are placeholder records (is_active: false) used only to request
  // the works_from_home permission. On approval we grant the permission then DELETE the
  // request record so it never appears as a real clock-in entry in WorkingHoursTab.
  if (existing && isHomeWfhApprovalRequest(existing)) {
    if (existing.employee_id != null) {
      const { error: wfhError } = await supabase
        .from('tenants_employee')
        .update({ works_from_home: true })
        .eq('id', existing.employee_id);
      if (wfhError) throw wfhError;
    }
    const { error: deleteError } = await supabase
      .from('employee_clock_in')
      .delete()
      .eq('id', recordId);
    if (deleteError) throw deleteError;
    return;
  }

  // Regular manual clock-in: mark as approved.
  const { error } = await supabase
    .from('employee_clock_in')
    .update({
      approved: true,
      declined: false,
      approved_by: approverAuthUserId,
      approved_at: new Date().toISOString(),
    })
    .eq('id', recordId);

  if (error) throw error;

  // Also auto-enable works_from_home if the approved entry is for a Home workplace.
  const inPlace = (existing as any)?.clock_in_place;
  const outPlace = (existing as any)?.clock_out_place;
  const inRec = Array.isArray(inPlace) ? inPlace[0] : inPlace;
  const outRec = Array.isArray(outPlace) ? outPlace[0] : outPlace;
  const inSlug = typeof inRec?.slug === 'string' ? inRec.slug.toLowerCase() : null;
  const outSlug = typeof outRec?.slug === 'string' ? outRec.slug.toLowerCase() : null;
  const inName = typeof inRec?.name === 'string' ? inRec.name.trim().toLowerCase() : null;
  const outName = typeof outRec?.name === 'string' ? outRec.name.trim().toLowerCase() : null;
  const isHome =
    inSlug === 'home'
    || outSlug === 'home'
    || inName === 'home'
    || outName === 'home'
    || (existing as any)?.clock_in_location_id === 3
    || (existing as any)?.clock_out_location_id === 3;

  if (existing?.employee_id != null && isHome) {
    const { error: wfhError } = await supabase
      .from('tenants_employee')
      .update({ works_from_home: true })
      .eq('id', existing.employee_id);
    if (wfhError) throw wfhError;
  }
}

export function filterManualApprovalModalRecords(
  records: ManualClockInApprovalRecord[],
): ManualClockInApprovalRecord[] {
  return records.filter((record) => getClockInApprovalStatus(record) === 'pending');
}

export function countPendingApprovalBuckets(records: ManualClockInApprovalRecord[]): {
  wfh: number;
  clock: number;
} {
  let wfh = 0;
  let clock = 0;
  for (const record of records) {
    if (getClockInApprovalStatus(record) !== 'pending') continue;
    if (isHomeWfhApprovalRequest(record)) wfh += 1;
    else clock += 1;
  }
  return { wfh, clock };
}

export async function declineClockInRecord(
  recordId: number,
  approverAuthUserId: string,
): Promise<'removed' | 'declined'> {
  const { data: existing, error: fetchError } = await supabase
    .from('employee_clock_in')
    .select('id, notes')
    .eq('id', recordId)
    .maybeSingle();

  if (fetchError) throw fetchError;

  if (existing && isHomeWfhApprovalRequest(existing)) {
    const { error: deleteError } = await supabase
      .from('employee_clock_in')
      .delete()
      .eq('id', recordId);
    if (deleteError) throw deleteError;
    return 'removed';
  }

  const { error } = await supabase
    .from('employee_clock_in')
    .update({
      approved: false,
      declined: true,
      approved_by: approverAuthUserId,
      approved_at: new Date().toISOString(),
    })
    .eq('id', recordId);

  if (error) throw error;
  return 'declined';
}

export function manualClockInWorkplaceLabel(
  record: ManualClockInApprovalRecord,
  which: 'in' | 'out',
): string {
  return resolveWorkplaceName(record, which);
}

/** Active clock-in start time per employee (latest if multiple). */
export async function fetchActiveClockInsByEmployeeIds(
  employeeIds: number[],
): Promise<Map<number, string>> {
  if (employeeIds.length === 0) return new Map();

  const { data, error } = await supabase
    .from('employee_clock_in')
    .select('employee_id, clock_in_time')
    .in('employee_id', employeeIds)
    .eq('is_active', true);

  if (error) throw error;

  const map = new Map<number, string>();
  for (const row of data ?? []) {
    const existing = map.get(row.employee_id);
    if (!existing || row.clock_in_time > existing) {
      map.set(row.employee_id, row.clock_in_time);
    }
  }
  return map;
}
