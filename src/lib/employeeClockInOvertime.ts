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

export const HOUR_MS = 60 * 60 * 1000;
export const DEFAULT_MIN_HOURS = 8;
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

export function nineHourReminderDismissedStorageKey(dateKey: string): string {
  return `clock_in_nine_hour_reminder_dismissed_${dateKey}`;
}

export function hasContinuedOvertimeToday(dateKey = getTodayDateKey()): boolean {
  return readClockInOptInFlag(overtimeContinueStorageKey(dateKey));
}

export function hasDismissedNineHourReminderToday(dateKey = getTodayDateKey()): boolean {
  return readClockInOptInFlag(nineHourReminderDismissedStorageKey(dateKey));
}

export function markNineHourReminderDismissedToday(dateKey = getTodayDateKey()): void {
  writeClockInOptInFlag(nineHourReminderDismissedStorageKey(dateKey));
}

export function normalizeMinHours(value: unknown): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return DEFAULT_MIN_HOURS;
  return parsed;
}

/**
 * How long today may run before the employee is clocked out: their base hours, plus any hours they
 * pre-added by hand.
 *
 * Mirrors `resolveClockInAllowanceMs` in `backend/src/services/nineHourAutoClockOutService.js`. The
 * pre-added hours are already inside the day's total, so counting them here cancels them out and
 * leaves the live session its full base hours.
 */
export function overtimeAllowanceMs(minHours: unknown, preAddedMs = 0): number {
  return normalizeMinHours(minHours) * HOUR_MS + Math.max(0, preAddedMs || 0);
}

/**
 * When the reminder popup should appear: one hour before the day's allowance runs out.
 *
 * Mirrors `resolveClockInStage` in `backend/src/services/nineHourAutoClockOutService.js`, which sends
 * the matching WhatsApp reminder at the same point and then clocks the employee out an hour later. If
 * the two drift apart the popup either nags people who are nowhere near their limit, or never shows
 * because they have already been clocked out.
 */
export function overtimeReminderThresholdMs(minHours: unknown, preAddedMs = 0): number {
  return Math.max(0, overtimeAllowanceMs(minHours, preAddedMs) - HOUR_MS);
}

/**
 * A timestamp as epoch milliseconds, or null when it cannot be read as one.
 *
 * The nullish check has to come first: `new Date(null)` is the epoch rather than an invalid date, so
 * a row with no clock-in would otherwise measure as decades of work.
 */
function toEpochMs(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null;
  const ms = new Date(value as string).getTime();
  return Number.isFinite(ms) ? ms : null;
}

/** The employee's contracted base hours, falling back to the company default. */
export async function fetchEmployeeMinHours(employeeId: number): Promise<number> {
  const { data, error } = await supabase
    .from('tenants_employee')
    .select('min_hours')
    .eq('id', employeeId)
    .maybeSingle();

  if (error) {
    console.error('Failed to load employee min_hours:', error);
    return DEFAULT_MIN_HOURS;
  }

  return normalizeMinHours(data?.min_hours);
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

/**
 * Markers that a session was typed in rather than clocked live.
 *
 * Mirrors `isPreAddedSession` in the backend service: `manually` alone is not enough, because the
 * manual-entry screens clear it when the session is short enough to auto-approve, but all of them set
 * `location_source` to 'manual'.
 */
function isPreAddedSession(record: {
  manually?: boolean | null;
  location_source?: string | null;
}): boolean {
  return (
    record.manually === true
    || String(record.location_source || '').trim().toLowerCase() === 'manual'
  );
}

/** Today's hours, split the same way the backend splits them. */
export type TodayHours = {
  /** Everything worked today, with the open session counted up to now. */
  elapsedMs: number;
  /** The share of that which was entered by hand, which is what extends the day's allowance. */
  preAddedMs: number;
};

export async function fetchTodayHours(employeeId: number): Promise<TodayHours> {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const todayStart = today.toISOString();
  const todayEnd = new Date(today.getTime() + 24 * 60 * 60 * 1000).toISOString();

  const { data, error } = await supabase
    .from('employee_clock_in')
    .select('clock_in_time, clock_out_time, manually, declined, location_source, is_active')
    .eq('employee_id', employeeId)
    .gte('clock_in_time', todayStart)
    .lt('clock_in_time', todayEnd);

  if (error) throw error;

  const now = Date.now();
  let elapsedMs = 0;
  let preAddedMs = 0;
  for (const record of data ?? []) {
    // A rejected entry is not worked time, so it neither counts down the day nor extends it.
    if (record.declined === true) continue;

    const start = toEpochMs(record.clock_in_time);
    if (start === null) continue;
    const end = (record.clock_out_time ? toEpochMs(record.clock_out_time) : null) ?? now;
    const ms = Math.max(0, end - start);

    elapsedMs += ms;
    // The open session is the one being measured, even if an edit left the manual marker on it.
    if (record.is_active !== true && isPreAddedSession(record)) preAddedMs += ms;
  }
  return { elapsedMs, preAddedMs };
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
 * Clock out and refresh local clock-in cache. Keeps the Supabase session signed in.
 * If the employee has require_clock_in, the CRM gate will re-block after refresh.
 */
export async function clockOutKeepSession(employeeId: number): Promise<void> {
  const record = await fetchActiveClockInRecord(employeeId);
  if (record) {
    await clockOutEmployeeRecord(record);
  }
  clearClockInGateCache();
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new Event('clock-in-session-changed'));
  }
}

/** @deprecated Prefer clockOutKeepSession — no longer signs out of Supabase. */
export async function clockOutAndSignOut(employeeId: number): Promise<void> {
  await clockOutKeepSession(employeeId);
}
