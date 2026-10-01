import { filterCountedClockInRecords } from './employeeClockInApproval';
import { eachDayInRange, isIsraeliWorkdayIso } from './employeeClockInFormat';
import { formatDurationMs } from './employeeClockInOvertime';
import { normalizeEmployeeMinHours } from './employeeLeadReporting';
import { getPremiumHolidaysForYearMap, preloadHolidayYears } from './israeliJewishHolidays';
import type {
  EmployeeUnavailabilityEntry,
  UnavailabilityDayEffectInput,
} from './employeeUnavailabilities';
import {
  buildGeneralAbsenceWindowsByDate,
  expandUnavailabilitiesToDailyRows,
  type GeneralAbsenceWindow,
} from './employeeUnavailabilities';
import { isAutoFilledClockInRecord, jerusalemOffsetForDate } from './autoFilledWorkingHours';
import type { ClockInExportRecord } from './workingHoursExport';

const JERUSALEM_TZ = 'Asia/Jerusalem';
const MS_PER_MINUTE = 60_000;
const MS_PER_HOUR = 60 * MS_PER_MINUTE;

/**
 * Fallback daily hours when an employee has no `min_hours` on record.
 *
 * Both the attendance balance and the overtime threshold come from the employee's own
 * `min_hours` — a single base per contract. Anything worked beyond it is overtime, and
 * anything short of it is missing hours; there is no unpaid band in between.
 */
export const DEFAULT_DAILY_MIN_HOURS = 8;

/** First overtime hours per day pay at 125%; any above that at 150%. */
export const OVERTIME_125_CAP_HOURS = 2;
const OVERTIME_125_CAP_MS = OVERTIME_125_CAP_HOURS * MS_PER_HOUR;

const OVERTIME_125_WEIGHT = 1.25;
const OVERTIME_150_WEIGHT = 1.5;

export type EmployeeExtraHoursTotals = {
  /** Payable overtime at 125% after missing-hours offset. */
  extraHours125Ms: number;
  /** Payable overtime at 150% after missing-hours offset. */
  extraHours150Ms: number;
  /** Final missing hours after offsetting against weighted overtime. */
  deficitHoursMs: number;
  /** Expected month base: min_hours × Sun–Thu days excluding the 9 premium holidays. */
  baseHoursMs: number;
};

const jerusalemDateKeyFormatter = new Intl.DateTimeFormat('en-CA', {
  timeZone: JERUSALEM_TZ,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

const jerusalemDayStartCache = new Map<string, number>();

function getJerusalemDateKeyFromMs(ms: number): string {
  return jerusalemDateKeyFormatter.format(new Date(ms));
}

function addDaysToDateKey(dateKey: string, days: number): string {
  const [y, m, d] = dateKey.split('-').map(Number);
  const dt = new Date(y, m - 1, d + days);
  const year = dt.getFullYear();
  const month = String(dt.getMonth() + 1).padStart(2, '0');
  const day = String(dt.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function jerusalemDayStartMs(dateKey: string): number {
  const cached = jerusalemDayStartCache.get(dateKey);
  if (cached !== undefined) return cached;

  const [y, m, d] = dateKey.split('-').map(Number);
  let low = Date.UTC(y, m - 1, d - 1, 0, 0, 0);
  let high = Date.UTC(y, m - 1, d + 1, 23, 59, 59);

  while (low < high) {
    const mid = Math.floor((low + high) / 2);
    const key = getJerusalemDateKeyFromMs(mid);
    if (key < dateKey) low = mid + 1;
    else high = mid;
  }

  jerusalemDayStartCache.set(dateKey, low);
  return low;
}

function getJerusalemDayOfWeek(dateKey: string): number {
  const [y, m, d] = dateKey.split('-').map(Number);
  return new Date(y, m - 1, d).getDay();
}

function isFridayOrSaturday(dateKey: string): boolean {
  const dow = getJerusalemDayOfWeek(dateKey);
  return dow === 5 || dow === 6;
}

function isSaturday(dateKey: string): boolean {
  return getJerusalemDayOfWeek(dateKey) === 6;
}

function hoursToMs(hours: number): number {
  return hours * MS_PER_HOUR;
}

function msToHours(ms: number): number {
  return ms / MS_PER_HOUR;
}

/**
 * Statutory holidays on this date.
 *
 * `holidayMap` must come from buildHolidayMapForRange, which is already restricted to
 * days off. Filtering titles here instead is what let "Rosh Hashana LaBehemot" in.
 */
export function getQualifyingHolidayNamesForDate(
  dateKey: string,
  holidayMap: Map<string, string[]>,
): string[] {
  return [...(holidayMap.get(dateKey) ?? [])];
}

/**
 * Qualifying holidays that begin on the evening of this civil date
 * (i.e. tomorrow is the holiday calendar date).
 */
export function getHolidayEveNamesForDate(
  dateKey: string,
  holidayMap: Map<string, string[]>,
): string[] {
  return getQualifyingHolidayNamesForDate(addDaysToDateKey(dateKey, 1), holidayMap);
}

/**
 * True on a qualifying holiday date, or the civil day before it.
 * Jewish holidays begin at sundown the evening before, so the prior weekday is also off.
 */
export function dayHasPremium150Holiday(
  dateKey: string,
  holidayMap: Map<string, string[]>,
): boolean {
  if (getQualifyingHolidayNamesForDate(dateKey, holidayMap).length > 0) return true;
  return getHolidayEveNamesForDate(dateKey, holidayMap).length > 0;
}

function isPremiumNonWorkday(dateKey: string, holidayMap: Map<string, string[]>): boolean {
  if (isFridayOrSaturday(dateKey)) return true;
  return dayHasPremium150Holiday(dateKey, holidayMap);
}

/**
 * How much of a clocked stretch fell inside a timed general absence.
 *
 * Absences are declared as Jerusalem wall-clock windows, so only the part that overlaps the
 * session counts: clocking in after the absence began, or out before it ended, means those hours
 * were never on the clock and must not be deducted.
 */
export function generalAbsenceOverlapMs(
  startMs: number,
  endMs: number,
  dateKey: string,
  windowsByDate: Map<string, GeneralAbsenceWindow[]>,
): number {
  const windows = windowsByDate.get(dateKey);
  if (!windows?.length) return 0;

  // Anchor on the day's UTC offset rather than local midnight plus N hours, so the October DST
  // changeover — which lands on a Sunday workday — does not shift the window by an hour.
  const midnightMs = Date.parse(`${dateKey}T00:00:00${jerusalemOffsetForDate(dateKey)}`);
  if (!Number.isFinite(midnightMs)) return 0;

  let overlapMs = 0;
  for (const window of windows) {
    const windowStartMs = midnightMs + window.startHour * MS_PER_HOUR;
    const windowEndMs = midnightMs + window.endHour * MS_PER_HOUR;
    overlapMs += Math.max(0, Math.min(endMs, windowEndMs) - Math.max(startMs, windowStartMs));
  }
  return overlapMs;
}

/**
 * Worked milliseconds per Jerusalem day, net of any timed general absence.
 *
 * Absence time is taken off worked hours rather than off the day's requirement, so the overtime
 * threshold is the employee's plain `min_hours` and an hour spent away can never be paid as
 * overtime just because the clock kept running.
 */
function sumWorkedMsByJerusalemDay(
  records: ClockInExportRecord[],
  nowMs: number,
  generalAbsenceWindowsByDate: Map<string, GeneralAbsenceWindow[]> = new Map(),
): Map<string, number> {
  const byDay = new Map<string, number>();

  for (const record of records) {
    const start = new Date(record.clock_in_time).getTime();
    const end = record.clock_out_time ? new Date(record.clock_out_time).getTime() : nowMs;
    if (!Number.isFinite(start) || end <= start) continue;

    // Synthetic standard hours are generated with the absence already taken out.
    const deductAbsence = !isAutoFilledClockInRecord(record);

    let cursor = start;
    while (cursor < end) {
      const dateKey = getJerusalemDateKeyFromMs(cursor);
      const dayEnd = jerusalemDayStartMs(addDaysToDateKey(dateKey, 1));
      const segmentEnd = Math.min(end, dayEnd);
      const chunkMs = deductAbsence
        ? segmentEnd - cursor
          - generalAbsenceOverlapMs(cursor, segmentEnd, dateKey, generalAbsenceWindowsByDate)
        : segmentEnd - cursor;
      if (chunkMs > 0) {
        byDay.set(dateKey, (byDay.get(dateKey) ?? 0) + chunkMs);
      }
      cursor = segmentEnd;
    }
  }

  return byDay;
}

/** Sun–Thu workdays excluding the nine qualifying holidays and their eve (day before). */
export function isDeficitTrackingWorkday(
  dateKey: string,
  holidayMap: Map<string, string[]>,
): boolean {
  if (!isIsraeliWorkdayIso(dateKey)) return false;
  return !dayHasPremium150Holiday(dateKey, holidayMap);
}

function splitOvertimeMs(dailyBalanceMs: number): { overtime125Ms: number; overtime150Ms: number } {
  const positive = Math.max(dailyBalanceMs, 0);
  const overtime125Ms = Math.min(positive, OVERTIME_125_CAP_MS);
  const overtime150Ms = Math.max(positive - OVERTIME_125_CAP_MS, 0);
  return { overtime125Ms, overtime150Ms };
}

/**
 * Convert overtime into weighted payroll value, deduct missing hours from 150% first
 * then 125%, then convert remaining value back to payable overtime hours.
 */
export function offsetMissingAgainstOvertimeHours(
  totalMissingHours: number,
  totalOvertime125Hours: number,
  totalOvertime150Hours: number,
): {
  finalOvertime125Hours: number;
  finalOvertime150Hours: number;
  finalMissingHours: number;
} {
  const missing = Math.max(0, totalMissingHours);
  const overtime125Value = Math.max(0, totalOvertime125Hours) * OVERTIME_125_WEIGHT;
  const overtime150Value = Math.max(0, totalOvertime150Hours) * OVERTIME_150_WEIGHT;

  const final150Value = Math.max(overtime150Value - missing, 0);
  const missingAfter150 = Math.max(missing - overtime150Value, 0);

  const final125Value = Math.max(overtime125Value - missingAfter150, 0);
  const finalMissingHours = Math.max(missingAfter150 - overtime125Value, 0);

  return {
    finalOvertime125Hours: final125Value / OVERTIME_125_WEIGHT,
    finalOvertime150Hours: final150Value / OVERTIME_150_WEIGHT,
    finalMissingHours,
  };
}

export function countBaseWorkingDaysInRange(
  from: string,
  to: string,
  holidayMap: Map<string, string[]>,
): number {
  let count = 0;
  for (const dateKey of eachDayInRange(from, to)) {
    if (isDeficitTrackingWorkday(dateKey, holidayMap)) count += 1;
  }
  return count;
}

/** Friday + Saturday days in the inclusive range. */
export function countWeekendDaysInRange(from: string, to: string): number {
  let count = 0;
  for (const dateKey of eachDayInRange(from, to)) {
    if (isFridayOrSaturday(dateKey)) count += 1;
  }
  return count;
}

/**
 * Qualifying holiday dates plus their eve (day before), within the range.
 * A day that is both counted once.
 */
export function countHolidayOrEveDaysInRange(
  from: string,
  to: string,
  holidayMap: Map<string, string[]>,
): number {
  let count = 0;
  for (const dateKey of eachDayInRange(from, to)) {
    if (
      getQualifyingHolidayNamesForDate(dateKey, holidayMap).length > 0 ||
      getHolidayEveNamesForDate(dateKey, holidayMap).length > 0
    ) {
      count += 1;
    }
  }
  return count;
}

export function calculateBaseHoursMs(
  minHours: number,
  from: string,
  to: string,
  holidayMap: Map<string, string[]>,
): number {
  const days = countBaseWorkingDaysInRange(from, to, holidayMap);
  return normalizeEmployeeMinHours(minHours) * days * MS_PER_HOUR;
}

/**
 * The daily hours that separate missing from overtime. `normalizeEmployeeMinHours` only falls back
 * for non-finite or negative input, so a literal `min_hours` of 0 survives — and a 0 base would
 * turn every worked minute into overtime. Treat non-positive as "not configured".
 */
function resolveDailyMinMs(minHours: number): number {
  const normalized = normalizeEmployeeMinHours(minHours);
  return (normalized > 0 ? normalized : DEFAULT_DAILY_MIN_HOURS) * MS_PER_HOUR;
}

function accumulateDailyAttendance(
  byDay: Map<string, number>,
  from: string,
  to: string,
  holidayMap: Map<string, string[]>,
  excludedDateKeys: Set<string>,
  dailyMinMs: number,
): { rawMissingMs: number; rawOvertime125Ms: number; rawOvertime150Ms: number } {
  let rawMissingMs = 0;
  let rawOvertime125Ms = 0;
  let rawOvertime150Ms = 0;

  for (const dateKey of eachDayInRange(from, to)) {
    const workedMs = byDay.get(dateKey) ?? 0;

    if (isDeficitTrackingWorkday(dateKey, holidayMap)) {
      if (excludedDateKeys.has(dateKey)) {
        // Sick / vacation day — no missing hours; any overtime still counts.
        if (workedMs > dailyMinMs) {
          const { overtime125Ms, overtime150Ms } = splitOvertimeMs(workedMs - dailyMinMs);
          rawOvertime125Ms += overtime125Ms;
          rawOvertime150Ms += overtime150Ms;
        }
        continue;
      }

      // One base per contract, compared against hours actually worked: short of min_hours is
      // missing, past it is overtime. Timed general absences are already out of `workedMs`, so
      // an absence reads as missing hours rather than shrinking what the day owes.
      if (workedMs < dailyMinMs) {
        rawMissingMs += dailyMinMs - workedMs;
      } else if (workedMs > dailyMinMs) {
        const { overtime125Ms, overtime150Ms } = splitOvertimeMs(workedMs - dailyMinMs);
        rawOvertime125Ms += overtime125Ms;
        rawOvertime150Ms += overtime150Ms;
      }
      continue;
    }

    // Friday, Saturday, and the nine holidays: no required hours; all worked hours → 150%.
    if (isPremiumNonWorkday(dateKey, holidayMap) && workedMs > 0) {
      rawOvertime150Ms += workedMs;
    }
  }

  return { rawMissingMs, rawOvertime125Ms, rawOvertime150Ms };
}

export function buildSickAndVacationDateKeys(
  entries: UnavailabilityDayEffectInput[],
  from: string,
  to: string,
  holidayMap: Map<string, string[]> = new Map(),
): Set<string> {
  const keys = new Set<string>();
  for (const row of expandUnavailabilitiesToDailyRows(entries as EmployeeUnavailabilityEntry[], from, to)) {
    if (row.unavailability_type !== 'sick_days' && row.unavailability_type !== 'vacation') continue;
    // Weekend / premium-holiday leave does not consume a sick or vacation day.
    if (!isDeficitTrackingWorkday(row.date, holidayMap)) continue;
    keys.add(row.date);
  }
  return keys;
}

/**
 * Count sick or vacation days that fall on regular Israeli workdays only
 * (Sun–Thu, excluding the nine qualifying Jewish holidays).
 */
export function countPaidUnavailabilityWorkdays(
  entries: UnavailabilityDayEffectInput[],
  type: 'sick_days' | 'vacation',
  from: string,
  to: string,
  holidayMap: Map<string, string[]>,
): number {
  const days = new Set<string>();
  for (const row of expandUnavailabilitiesToDailyRows(entries as EmployeeUnavailabilityEntry[], from, to)) {
    if (row.unavailability_type !== type) continue;
    if (!isDeficitTrackingWorkday(row.date, holidayMap)) continue;
    days.add(row.date);
  }
  return days.size;
}

export function calculateEmployeeExtraHours(
  records: ClockInExportRecord[],
  minHours: number,
  holidayMap: Map<string, string[]>,
  from: string,
  to: string,
  unavailabilities: UnavailabilityDayEffectInput[] = [],
  nowMs = Date.now(),
): EmployeeExtraHoursTotals {
  const counted = filterCountedClockInRecords(records);
  const byDay = sumWorkedMsByJerusalemDay(
    counted,
    nowMs,
    buildGeneralAbsenceWindowsByDate(unavailabilities, from, to),
  );
  const excludedDays = buildSickAndVacationDateKeys(unavailabilities, from, to, holidayMap);
  const dailyMinMs = resolveDailyMinMs(minHours);

  const { rawMissingMs, rawOvertime125Ms, rawOvertime150Ms } = accumulateDailyAttendance(
    byDay,
    from,
    to,
    holidayMap,
    excludedDays,
    dailyMinMs,
  );

  const offset = offsetMissingAgainstOvertimeHours(
    msToHours(rawMissingMs),
    msToHours(rawOvertime125Ms),
    msToHours(rawOvertime150Ms),
  );

  return {
    extraHours125Ms: hoursToMs(offset.finalOvertime125Hours),
    extraHours150Ms: hoursToMs(offset.finalOvertime150Hours),
    deficitHoursMs: hoursToMs(offset.finalMissingHours),
    baseHoursMs: calculateBaseHoursMs(minHours, from, to, holidayMap),
  };
}

export function formatExtraHoursDuration(ms: number): string {
  if (ms <= 0) return '0h 0m';
  return formatDurationMs(ms);
}

export async function preloadHolidayMapsForRange(from: string, to: string): Promise<void> {
  const years = new Set<number>();
  const [fromY] = from.split('-').map(Number);
  const [toY] = to.split('-').map(Number);
  if (Number.isFinite(fromY)) years.add(fromY);
  if (Number.isFinite(toY)) years.add(toY);
  await preloadHolidayYears([...years]);
}

/**
 * Statutory days off in a date range (call preloadHolidayMapsForRange first).
 * Minor holidays and Rosh Chodesh are excluded — they are normal working days.
 */
export function buildHolidayMapForRange(from: string, to: string): Map<string, string[]> {
  const years = new Set<number>();
  const [fromY] = from.split('-').map(Number);
  const [toY] = to.split('-').map(Number);
  if (Number.isFinite(fromY)) years.add(fromY);
  if (Number.isFinite(toY)) years.add(toY);

  const mergedHolidayMap = new Map<string, string[]>();
  for (const year of years) {
    const yearMap = getPremiumHolidaysForYearMap(year);
    for (const [date, names] of yearMap) {
      if (date < from || date > to) continue;
      mergedHolidayMap.set(date, names);
    }
  }
  return mergedHolidayMap;
}

export function calculateExtraHoursByEmployee(
  recordsByEmployee: Map<number, ClockInExportRecord[]>,
  minHoursByEmployee: Map<number, number>,
  holidayMap: Map<string, string[]>,
  from: string,
  to: string,
  unavailabilitiesByEmployee: Map<
    number,
    UnavailabilityDayEffectInput[]
  > = new Map(),
  nowMs = Date.now(),
): Map<number, EmployeeExtraHoursTotals> {
  const result = new Map<number, EmployeeExtraHoursTotals>();
  for (const [employeeId, records] of recordsByEmployee) {
    const minHours = minHoursByEmployee.get(employeeId) ?? DEFAULT_DAILY_MIN_HOURS;
    result.set(
      employeeId,
      calculateEmployeeExtraHours(
        records,
        minHours,
        holidayMap,
        from,
        to,
        unavailabilitiesByEmployee.get(employeeId) ?? [],
        nowMs,
      ),
    );
  }
  return result;
}

export function getHolidayMapForDateKey(dateKey: string): Map<string, string[]> {
  const year = Number(dateKey.slice(0, 4));
  if (!Number.isFinite(year)) return new Map();
  return getPremiumHolidaysForYearMap(year);
}

export function calculateEmployeeExtraHoursForRange(
  records: ClockInExportRecord[],
  minHours: number,
  from: string,
  to: string,
  unavailabilities: UnavailabilityDayEffectInput[] = [],
  nowMs = Date.now(),
): EmployeeExtraHoursTotals {
  return calculateEmployeeExtraHours(
    records,
    minHours,
    buildHolidayMapForRange(from, to),
    from,
    to,
    unavailabilities,
    nowMs,
  );
}

/** True when the calendar day is Friday or Saturday (Israeli weekend). */
export function isIsraeliWeekendIso(dateKey: string): boolean {
  return isFridayOrSaturday(dateKey);
}

/** Kept for callers that previously checked Saturday-only premium days. */
export function isSaturdayIso(dateKey: string): boolean {
  return isSaturday(dateKey);
}
