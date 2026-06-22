import { supabase } from './supabase';
import {
  broadcastClockInOptIn,
  readClockInOptInFlag,
  writeClockInOptInFlag,
} from './clockInOptInCrossTab';
import {
  getTodayDateKey,
  JERUSALEM_WORKDAY_END_HOUR,
} from './employeeClockInOvertime';

export {
  isPastJerusalemWorkdayEnd,
  JERUSALEM_WORKDAY_END_HOUR,
  OVERTIME_FINAL_COUNTDOWN_MS,
  OVERTIME_PROMPT_MS,
} from './employeeClockInOvertime';

export const WORKDAY_END_POLL_MS = 30_000;

const JERUSALEM_TZ = 'Asia/Jerusalem';

export function workdayEndContinueStorageKey(dateKey: string): string {
  return `clock_in_workday_end_continue_${dateKey}`;
}

export function hasContinuedWorkdayEndToday(dateKey = getTodayDateKey()): boolean {
  return readClockInOptInFlag(workdayEndContinueStorageKey(dateKey));
}

export async function fetchWorkdayEndOptInFromDb(
  employeeId: number,
  dateKey = getTodayDateKey(),
): Promise<boolean> {
  const { data, error } = await supabase
    .from('employee_clock_in_workday_end_opt_in')
    .select('employee_id')
    .eq('employee_id', employeeId)
    .eq('work_date', dateKey)
    .maybeSingle();

  if (error) {
    console.error('Failed to load workday-end opt-in:', error);
    return false;
  }

  return data != null;
}

export async function markContinuedWorkdayEndToday(
  employeeId: number | null | undefined,
  dateKey = getTodayDateKey(),
): Promise<void> {
  writeClockInOptInFlag(workdayEndContinueStorageKey(dateKey));
  broadcastClockInOptIn('workday_end', dateKey, employeeId);

  if (employeeId == null) return;

  const { error } = await supabase.from('employee_clock_in_workday_end_opt_in').upsert(
    { employee_id: employeeId, work_date: dateKey },
    { onConflict: 'employee_id,work_date' },
  );

  if (error) {
    console.error('Failed to persist workday-end opt-in:', error);
  }
}

function jerusalemTimeParts(date: Date) {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: JERUSALEM_TZ,
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).formatToParts(date);
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value ?? 0);
  return { hour: get('hour'), minute: get('minute'), second: get('second') };
}

/** True after 23:02:20 Jerusalem — same response window as the in-browser modal. */
export function isPastWorkdayEndClientDeadline(now = new Date()): boolean {
  const { hour, minute, second } = jerusalemTimeParts(now);
  if (hour > JERUSALEM_WORKDAY_END_HOUR) return true;
  if (hour < JERUSALEM_WORKDAY_END_HOUR) return false;
  if (minute > 2) return true;
  if (minute < 2) return false;
  return second >= 20;
}

export function formatWorkdayEndTimeLabel(): string {
  return `${String(JERUSALEM_WORKDAY_END_HOUR).padStart(2, '0')}:00`;
}
