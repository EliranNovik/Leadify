import { supabase } from './supabase';
import { dateRangeToIsoBounds, toDateInputValue } from './employeeClockInFormat';
import {
  assertDateEditableForEmployee,
  yearMonthFromDateKey,
  assertWorkingHoursMonthEditable,
} from './employeeWorkingHoursSubmissions';
import { insertClockInRevision } from './employeeClockInRevisions';
import {
  assertManualDurationAllowed,
  type ClockInOvertimeApprovalFileMeta,
} from './employeeClockInOvertimeApproval';

/** Notes tag for pending sessions created from the daily lead allocation page. */
export const LEAD_ALLOCATION_HOURS_NOTE = 'Lead allocation hours';

export type ManualClockInPayload = {
  employeeId: number;
  userId: string;
  date: string;
  clockInTime: string;
  clockOutTime: string;
  notes?: string;
  clockInLocationId?: number | null;
  clockOutLocationId?: number | null;
  overtimeApproval?: ClockInOvertimeApprovalFileMeta | null;
};

function combineDateAndTime(date: string, time: string): Date {
  return new Date(`${date}T${time}`);
}

/**
 * Clock-in rows must use the *employee's* auth uid so My Profile stays in sync with HR.
 * When HR adds a manual entry, payload.userId is often the HR user's auth id.
 */
export async function resolveEmployeeAuthUserId(
  employeeId: number,
  fallbackUserId: string,
): Promise<string> {
  const { data, error } = await supabase
    .from('users')
    .select('auth_id')
    .eq('employee_id', employeeId)
    .not('auth_id', 'is', null)
    .limit(1)
    .maybeSingle();

  if (error) {
    console.warn('resolveEmployeeAuthUserId:', error.message);
    return fallbackUserId;
  }

  const authId = typeof data?.auth_id === 'string' ? data.auth_id.trim() : '';
  return authId || fallbackUserId;
}

export async function insertManualClockInRecord(
  payload: ManualClockInPayload,
): Promise<void> {
  const clockIn = combineDateAndTime(payload.date, payload.clockInTime);
  const clockOut = combineDateAndTime(payload.date, payload.clockOutTime);

  if (clockOut.getTime() <= clockIn.getTime()) {
    throw new Error('Clock out must be after clock in');
  }

  await assertDateEditableForEmployee(payload.employeeId, payload.date);
  // Cap is read from tenants_employee.min_hours at save time only.
  // Stored clock_in_time / clock_out_time stay exactly as entered.
  await assertManualDurationAllowed({
    employeeId: payload.employeeId,
    clockInTime: payload.clockInTime,
    clockOutTime: payload.clockOutTime,
    overtimeApprovalStoragePath: payload.overtimeApproval?.storagePath,
  });

  const employeeUserId = await resolveEmployeeAuthUserId(
    payload.employeeId,
    payload.userId,
  );

  const row: Record<string, unknown> = {
    employee_id: payload.employeeId,
    user_id: employeeUserId,
    clock_in_time: clockIn.toISOString(),
    clock_out_time: clockOut.toISOString(),
    manually: true,
    approved: false,
    declined: false,
    approved_by: null,
    approved_at: null,
    is_active: false,
    notes: payload.notes?.trim() || null,
    location_source: 'manual',
  };

  if (payload.overtimeApproval?.storagePath) {
    row.overtime_approval_storage_path = payload.overtimeApproval.storagePath;
    row.overtime_approval_file_name = payload.overtimeApproval.fileName || null;
    row.overtime_approval_mime_type = payload.overtimeApproval.mimeType || null;
  }

  if (payload.clockInLocationId) {
    row.clock_in_location_id = payload.clockInLocationId;
  }
  if (payload.clockOutLocationId) {
    row.clock_out_location_id = payload.clockOutLocationId;
  }

  let { error } = await supabase.from('employee_clock_in').insert(row);

  if (error && (row.clock_in_location_id || row.clock_out_location_id)) {
    const withoutPresets = { ...row };
    delete withoutPresets.clock_in_location_id;
    delete withoutPresets.clock_out_location_id;
    const retry = await supabase.from('employee_clock_in').insert(withoutPresets);
    error = retry.error;
  }

  if (error && String(error.message || '').includes('overtime_approval')) {
    throw new Error(
      'Overtime approval screenshot could not be saved. Run sql/2026-09-24_employee_clock_in_overtime_approval.sql and try again.',
    );
  }

  if (error) throw error;
}

export async function insertManualClockInRecords(
  payload: Omit<ManualClockInPayload, 'date'> & { dates: string[] },
): Promise<number> {
  const uniqueDates = [...new Set(payload.dates)].sort();
  if (uniqueDates.length === 0) {
    throw new Error('Select at least one date');
  }

  for (const date of uniqueDates) {
    await insertManualClockInRecord({ ...payload, date });
  }

  return uniqueDates.length;
}

export type ClockInSessionUpdate = {
  id: number;
  date: string;
  clockInTime: string;
  clockOutTime: string;
  notes?: string;
  clockInLocationId?: number | null;
  clockOutLocationId?: number | null;
  overtimeApproval?: ClockInOvertimeApprovalFileMeta | null;
};

function isoToTimeInput(iso: string): string {
  const d = new Date(iso);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

export function clockInSessionToFormValues(session: {
  id: number;
  clock_in_time: string;
  clock_out_time: string | null;
  notes: string | null;
  clock_in_location_id?: number | null;
  clock_out_location_id?: number | null;
}): ClockInSessionUpdate {
  const date = toDateInputValue(new Date(session.clock_in_time));
  return {
    id: session.id,
    date,
    clockInTime: isoToTimeInput(session.clock_in_time),
    clockOutTime: session.clock_out_time
      ? isoToTimeInput(session.clock_out_time)
      : isoToTimeInput(session.clock_in_time),
    notes: session.notes?.trim() || '',
    clockInLocationId: session.clock_in_location_id ?? null,
    clockOutLocationId: session.clock_out_location_id ?? null,
  };
}

export async function updateClockInSession(update: ClockInSessionUpdate): Promise<void> {
  const overtimeSelect = `employee_id, clock_in_time, clock_out_time, notes, manually, approved, declined,
       approved_by, approved_at, clock_in_location_id, clock_out_location_id,
       overtime_approval_storage_path, overtime_approval_file_name, overtime_approval_mime_type,
       location_latitude, location_longitude, location_address, location_city, location_country, location_source,
       clock_out_location_latitude, clock_out_location_longitude,
       clock_out_location_address, clock_out_location_city, clock_out_location_country, clock_out_location_source`;
  const coreSelect = `employee_id, clock_in_time, clock_out_time, notes, manually, approved, declined,
       approved_by, approved_at, clock_in_location_id, clock_out_location_id,
       location_latitude, location_longitude, location_address, location_city, location_country, location_source,
       clock_out_location_latitude, clock_out_location_longitude,
       clock_out_location_address, clock_out_location_city, clock_out_location_country, clock_out_location_source`;

  let { data: existing, error: fetchError } = await supabase
    .from('employee_clock_in')
    .select(overtimeSelect)
    .eq('id', update.id)
    .single();

  if (fetchError && /overtime_approval/i.test(fetchError.message || '')) {
    const retry = await supabase
      .from('employee_clock_in')
      .select(coreSelect)
      .eq('id', update.id)
      .single();
    existing = retry.data;
    fetchError = retry.error;
  }

  if (fetchError) throw fetchError;
  if (!existing) throw new Error('Clock-in entry not found');

  const previousDateKey = toDateInputValue(new Date(existing.clock_in_time));
  await assertDateEditableForEmployee(existing.employee_id, previousDateKey);
  if (update.date !== previousDateKey) {
    await assertDateEditableForEmployee(existing.employee_id, update.date);
  }

  const clockIn = combineDateAndTime(update.date, update.clockInTime);
  const clockOut = combineDateAndTime(update.date, update.clockOutTime);

  if (clockOut.getTime() <= clockIn.getTime()) {
    throw new Error('Clock out must be after clock in');
  }

  await assertManualDurationAllowed({
    employeeId: existing.employee_id,
    clockInTime: update.clockInTime,
    clockOutTime: update.clockOutTime,
    overtimeApprovalStoragePath:
      update.overtimeApproval?.storagePath
      || existing.overtime_approval_storage_path
      || null,
  });

  const previousForm = clockInSessionToFormValues({
    id: update.id,
    clock_in_time: existing.clock_in_time,
    clock_out_time: existing.clock_out_time,
    notes: existing.notes,
    clock_in_location_id: existing.clock_in_location_id,
    clock_out_location_id: existing.clock_out_location_id,
  });

  const materialFieldsUnchanged =
    previousForm.date === update.date
    && previousForm.clockInTime === update.clockInTime
    && previousForm.clockOutTime === update.clockOutTime
    && (previousForm.clockInLocationId ?? null) === (update.clockInLocationId ?? null)
    && (previousForm.clockOutLocationId ?? null) === (update.clockOutLocationId ?? null);

  const wasEffectivelyApproved =
    existing.declined !== true
    && (existing.manually !== true || existing.approved === true);

  const preserveApproval = wasEffectivelyApproved && materialFieldsUnchanged;

  if (!preserveApproval) {
    await insertClockInRevision(
      update.id,
      existing,
      existing.manually !== true ? 'automatic' : 'manual',
    );
  }

  const row: Record<string, unknown> = {
    clock_in_time: clockIn.toISOString(),
    clock_out_time: clockOut.toISOString(),
    is_active: false,
    manually: true,
    notes: update.notes?.trim() || null,
    location_source: 'manual',
    approved: preserveApproval,
    declined: false,
    approved_by: preserveApproval ? existing.approved_by : null,
    approved_at: preserveApproval ? existing.approved_at : null,
  };

  const overtimePath =
    update.overtimeApproval?.storagePath
    || existing.overtime_approval_storage_path
    || null;
  if (overtimePath) {
    row.overtime_approval_storage_path = overtimePath;
    row.overtime_approval_file_name =
      update.overtimeApproval?.fileName || existing.overtime_approval_file_name || null;
    row.overtime_approval_mime_type =
      update.overtimeApproval?.mimeType || existing.overtime_approval_mime_type || null;
  }

  if (update.clockInLocationId) {
    row.clock_in_location_id = update.clockInLocationId;
  } else {
    row.clock_in_location_id = null;
  }
  if (update.clockOutLocationId) {
    row.clock_out_location_id = update.clockOutLocationId;
  } else {
    row.clock_out_location_id = null;
  }

  let { error } = await supabase
    .from('employee_clock_in')
    .update(row)
    .eq('id', update.id);

  if (error && (row.clock_in_location_id || row.clock_out_location_id)) {
    const withoutPresets = { ...row };
    delete withoutPresets.clock_in_location_id;
    delete withoutPresets.clock_out_location_id;
    const retry = await supabase
      .from('employee_clock_in')
      .update(withoutPresets)
      .eq('id', update.id);
    error = retry.error;
  }

  if (error && String(error.message || '').includes('overtime_approval')) {
    throw new Error(
      'Overtime approval screenshot could not be saved. Run sql/2026-09-24_employee_clock_in_overtime_approval.sql and try again.',
    );
  }

  if (error) throw error;
}

export async function updateClockInSessions(updates: ClockInSessionUpdate[]): Promise<void> {
  for (const update of updates) {
    await updateClockInSession(update);
  }
}

export async function deleteClockInSessions(ids: number[]): Promise<void> {
  if (ids.length === 0) return;

  const { data: rows, error: fetchError } = await supabase
    .from('employee_clock_in')
    .select('id, employee_id, clock_in_time')
    .in('id', ids);

  if (fetchError) throw fetchError;

  const checkedMonths = new Set<string>();
  for (const row of rows ?? []) {
    const dateKey = toDateInputValue(new Date(row.clock_in_time));
    const { year, month } = yearMonthFromDateKey(dateKey);
    const key = `${row.employee_id}-${year}-${month}`;
    if (checkedMonths.has(key)) continue;
    checkedMonths.add(key);
    await assertWorkingHoursMonthEditable(row.employee_id, year, month);
  }

  const { error } = await supabase.from('employee_clock_in').delete().in('id', ids);
  if (error) throw error;
}

const REPLACE_DAY_SELECT = `
  id, employee_id, clock_in_time, clock_out_time, notes, manually, approved, declined,
  approved_by, approved_at, clock_in_location_id, clock_out_location_id,
  location_latitude, location_longitude, location_address, location_city, location_country, location_source,
  clock_out_location_latitude, clock_out_location_longitude,
  clock_out_location_address, clock_out_location_city, clock_out_location_country, clock_out_location_source
`;

/**
 * Replace all clock-in sessions on a calendar day with one pending manual session.
 * Existing rows are archived to revisions then deleted so approval cannot double-count.
 */
export async function replaceDayWithPendingManualSession(params: {
  employeeId: number;
  userId: string;
  date: string;
  clockInTime: string;
  clockOutTime: string;
  locationId: number;
  notes?: string | null;
}): Promise<void> {
  const clockIn = combineDateAndTime(params.date, params.clockInTime);
  const clockOut = combineDateAndTime(params.date, params.clockOutTime);
  if (clockOut.getTime() <= clockIn.getTime()) {
    throw new Error('Clock out must be after clock in');
  }
  if (!params.locationId) {
    throw new Error('Select a workplace');
  }

  await assertDateEditableForEmployee(params.employeeId, params.date);

  const { start, end } = dateRangeToIsoBounds(params.date, params.date);
  const { data: existingRows, error: fetchError } = await supabase
    .from('employee_clock_in')
    .select(REPLACE_DAY_SELECT)
    .eq('employee_id', params.employeeId)
    .gte('clock_in_time', start)
    .lte('clock_in_time', end);

  if (fetchError) throw fetchError;

  const sameDayRows = (existingRows || []).filter(
    (row) => toDateInputValue(new Date(row.clock_in_time)) === params.date,
  );

  for (const row of sameDayRows) {
    await insertClockInRevision(
      row.id,
      row,
      row.manually === true ? 'manual' : 'automatic',
    );
  }

  if (sameDayRows.length > 0) {
    const { error: deleteError } = await supabase
      .from('employee_clock_in')
      .delete()
      .in(
        'id',
        sameDayRows.map((row) => row.id),
      );
    if (deleteError) throw deleteError;
  }

  const noteText = (params.notes?.trim() || LEAD_ALLOCATION_HOURS_NOTE).includes(
    LEAD_ALLOCATION_HOURS_NOTE,
  )
    ? params.notes?.trim() || LEAD_ALLOCATION_HOURS_NOTE
    : `${LEAD_ALLOCATION_HOURS_NOTE}${params.notes?.trim() ? ` — ${params.notes.trim()}` : ''}`;

  await insertManualClockInRecord({
    employeeId: params.employeeId,
    userId: params.userId,
    date: params.date,
    clockInTime: params.clockInTime,
    clockOutTime: params.clockOutTime,
    notes: noteText,
    clockInLocationId: params.locationId,
    clockOutLocationId: params.locationId,
  });
}
