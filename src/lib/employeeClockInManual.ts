import { supabase } from './supabase';
import { toDateInputValue } from './employeeClockInFormat';
import {
  assertDateEditableForEmployee,
  yearMonthFromDateKey,
  assertWorkingHoursMonthEditable,
} from './employeeWorkingHoursSubmissions';
import { insertClockInRevision } from './employeeClockInRevisions';

export type ManualClockInPayload = {
  employeeId: number;
  userId: string;
  date: string;
  clockInTime: string;
  clockOutTime: string;
  notes?: string;
  clockInLocationId?: number | null;
  clockOutLocationId?: number | null;
};

function combineDateAndTime(date: string, time: string): Date {
  return new Date(`${date}T${time}`);
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

  const row: Record<string, unknown> = {
    employee_id: payload.employeeId,
    user_id: payload.userId,
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
  const { data: existing, error: fetchError } = await supabase
    .from('employee_clock_in')
    .select(
      `employee_id, clock_in_time, clock_out_time, notes, manually, approved, declined,
       approved_by, approved_at, clock_in_location_id, clock_out_location_id,
       location_latitude, location_longitude, location_address, location_city, location_country, location_source,
       clock_out_location_latitude, clock_out_location_longitude,
       clock_out_location_address, clock_out_location_city, clock_out_location_country, clock_out_location_source`,
    )
    .eq('id', update.id)
    .single();

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
