import { supabase } from './supabase';
import { clearClockInGateCache } from './clockInGateCache';
import {
  broadcastClockInOptIn,
  readClockInOptInFlag,
  writeClockInOptInFlag,
} from './clockInOptInCrossTab';
import {
  clockOutEmployeeRecord,
  fetchActiveClockInRecord,
} from './employeeClockOut';

export const NINE_HOURS_MS = 9 * 60 * 60 * 1000;
export const OVERTIME_PROMPT_MS = 10 * 60 * 1000;
export const OVERTIME_FINAL_COUNTDOWN_MS = 20 * 1000;
export const OVERTIME_POLL_MS = 30_000;
export const JERUSALEM_WORKDAY_END_HOUR = 23;

const JERUSALEM_TZ = 'Asia/Jerusalem';

export function getJerusalemTodayDateKey(date = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: JERUSALEM_TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date);
}

export function getTodayDateKey(): string {
  return getJerusalemTodayDateKey();
}

export function isPastJerusalemWorkdayEnd(now = new Date()): boolean {
  const hour = Number(
    new Intl.DateTimeFormat('en-GB', {
      timeZone: JERUSALEM_TZ,
      hour: '2-digit',
      hour12: false,
    }).format(now),
  );
  return hour >= JERUSALEM_WORKDAY_END_HOUR;
}

export function overtimeContinueStorageKey(dateKey: string): string {
  return `clock_in_overtime_continue_${dateKey}`;
}

export function hasContinuedOvertimeToday(dateKey = getTodayDateKey()): boolean {
  return readClockInOptInFlag(overtimeContinueStorageKey(dateKey));
}

export async function fetchOvertimeOptInFromDb(
  employeeId: number,
  dateKey = getTodayDateKey(),
): Promise<boolean> {
  const { data, error } = await supabase
    .from('employee_clock_in_overtime_opt_in')
    .select('employee_id')
    .eq('employee_id', employeeId)
    .eq('work_date', dateKey)
    .maybeSingle();

  if (error) {
    console.error('Failed to load overtime opt-in:', error);
    return false;
  }

  return data != null;
}

export async function markContinuedOvertimeToday(
  employeeId: number | null | undefined,
  dateKey = getTodayDateKey(),
): Promise<boolean> {
  writeClockInOptInFlag(overtimeContinueStorageKey(dateKey));
  broadcastClockInOptIn('overtime', dateKey, employeeId);

  if (employeeId == null) return true;

  const { error } = await supabase.from('employee_clock_in_overtime_opt_in').upsert(
    { employee_id: employeeId, work_date: dateKey },
    { onConflict: 'employee_id,work_date' },
  );

  if (error) {
    console.error('Failed to persist overtime opt-in:', error);
    return false;
  }

  return true;
}

export async function fetchTodayClockedMs(employeeId: number): Promise<number> {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const todayStart = today.toISOString();
  const todayEnd = new Date(today.getTime() + 24 * 60 * 60 * 1000).toISOString();

  const { data, error } = await supabase
    .from('employee_clock_in')
    .select('clock_in_time, clock_out_time')
    .eq('employee_id', employeeId)
    .gte('clock_in_time', todayStart)
    .lt('clock_in_time', todayEnd);

  if (error) throw error;

  const now = Date.now();
  let totalMs = 0;
  for (const record of data ?? []) {
    const start = new Date(record.clock_in_time).getTime();
    const end = record.clock_out_time
      ? new Date(record.clock_out_time).getTime()
      : now;
    totalMs += Math.max(0, end - start);
  }
  return totalMs;
}

export function formatDurationMs(ms: number): string {
  const hours = Math.floor(ms / (1000 * 60 * 60));
  const minutes = Math.floor((ms % (1000 * 60 * 60)) / (1000 * 60));
  return `${hours}h ${minutes}m`;
}

export function formatCountdownSeconds(totalSeconds: number): string {
  const clamped = Math.max(0, totalSeconds);
  const minutes = Math.floor(clamped / 60);
  const seconds = clamped % 60;
  return `${minutes}:${String(seconds).padStart(2, '0')}`;
}

/**
 * Clock out and clear the gate cache. Keeps the Supabase session signed in
 * so the user lands on the clock-in gate (QR / manual) without re-authenticating.
 */
export async function clockOutKeepSession(employeeId: number): Promise<void> {
  const record = await fetchActiveClockInRecord(employeeId);
  if (record) {
    await clockOutEmployeeRecord(record);
  }
  clearClockInGateCache();
}

/** @deprecated Prefer clockOutKeepSession — no longer signs out of Supabase. */
export async function clockOutAndSignOut(employeeId: number): Promise<void> {
  await clockOutKeepSession(employeeId);
}
