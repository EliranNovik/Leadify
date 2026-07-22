import { supabase } from './supabase';
import {
  detectClockInLocation,
  locationToDbFields,
} from './employeeClockInLocation';
import { persistLastSelectedWorkplaceId } from './clockInLocations';

export type ActiveClockInRecord = {
  id: number;
  clock_in_location_id: number | null;
  clock_in_time: string;
};

export async function fetchActiveClockInRecord(
  employeeId: number,
): Promise<ActiveClockInRecord | null> {
  const { data, error } = await supabase
    .from('employee_clock_in')
    .select('id, clock_in_location_id, clock_in_time')
    .eq('employee_id', employeeId)
    .eq('is_active', true)
    .order('clock_in_time', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error && error.code !== 'PGRST116') {
    throw error;
  }

  return data ?? null;
}

export async function clockOutEmployeeRecord(
  record: ActiveClockInRecord,
  options?: { skipGeolocation?: boolean; clockOutTime?: string },
): Promise<void> {
  const clockOutLocationId = record.clock_in_location_id;
  if (!clockOutLocationId) {
    throw new Error('Missing workplace for clock-out');
  }

  const clockOutTime =
    options?.clockOutTime && !Number.isNaN(Date.parse(options.clockOutTime))
      ? new Date(options.clockOutTime).toISOString()
      : new Date().toISOString();

  // Never violate employee_clock_in_time_check
  const clockInMs = new Date(record.clock_in_time).getTime();
  const clockOutMs = new Date(clockOutTime).getTime();
  const safeClockOutTime =
    Number.isFinite(clockInMs) && Number.isFinite(clockOutMs) && clockOutMs < clockInMs
      ? new Date().toISOString()
      : clockOutTime;

  const baseUpdate = {
    clock_out_time: safeClockOutTime,
    is_active: false,
    notes: null,
    clock_out_location_id: clockOutLocationId,
  };
  const gpsFields = options?.skipGeolocation
    ? {}
    : locationToDbFields(await detectClockInLocation(), 'clock_out_');

  let { error } = await supabase
    .from('employee_clock_in')
    .update({ ...baseUpdate, ...gpsFields })
    .eq('id', record.id);

  if (error) {
    const { clock_out_location_id: _drop, ...withoutPreset } = baseUpdate;
    const retry = await supabase
      .from('employee_clock_in')
      .update({ ...withoutPreset, ...gpsFields })
      .eq('id', record.id);
    error = retry.error;
  }

  if (error) {
    const retry2 = await supabase
      .from('employee_clock_in')
      .update({
        clock_out_time: baseUpdate.clock_out_time,
        is_active: false,
        notes: baseUpdate.notes,
      })
      .eq('id', record.id);
    error = retry2.error;
  }

  if (error) throw error;

  persistLastSelectedWorkplaceId(clockOutLocationId);
}
