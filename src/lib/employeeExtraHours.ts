import { filterCountedClockInRecords } from './employeeClockInApproval';
import { eachDayInRange, isIsraeliWorkdayIso } from './employeeClockInFormat';
import { formatDurationMs } from './employeeClockInOvertime';
import { normalizeEmployeeMinHours } from './employeeLeadReporting';
import { getHolidaysForYearMap, preloadHolidayYears } from './israeliJewishHolidays';
import type { EmployeeUnavailabilityEntry } from './employeeUnavailabilities';
import { expandUnavailabilitiesToDailyRows } from './employeeUnavailabilities';
import type { ClockInExportRecord } from './workingHoursExport';

const JERUSALEM_TZ = 'Asia/Jerusalem';
const MS_PER_MINUTE = 60_000;
const MS_PER_HOUR = 60 * MS_PER_MINUTE;

/** Required hours on a regular workday for attendance balance. */
export const REQUIRED_DAILY_HOURS = 8;
const REQUIRED_DAILY_MS = REQUIRED_DAILY_HOURS * MS_PER_HOUR;

/** First overtime hours per day pay at 125%; any above that at 150%. */
export const OVERTIME_125_CAP_HOURS = 2;
const OVERTIME_125_CAP_MS = OVERTIME_125_CAP_HOURS * MS_PER_HOUR;

/** @deprecated Use OVERTIME_125_CAP_HOURS + REQUIRED_DAILY_HOURS (8 + 2 = 10). */
export const DAILY_PREMIUM_150_HOUR_THRESHOLD = REQUIRED_DAILY_HOURS + OVERTIME_125_CAP_HOURS;

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

/** Holidays that qualify for 150% / are excluded from regular workdays (Hebcal titles). */
export function isQualifyingPremium150Holiday(title: string): boolean {
  const normalized = title.trim().toLowerCase();
  if (!normalized || normalized.includes('erev')) return false;
  if (normalized.includes('chol ha') || normalized.includes('hol ha')) return false;

  if (/rosh hashana/.test(normalized)) return true;
  if (/yom kippur/.test(normalized)) return true;
  if (/^sukkot i\b/.test(normalized) || /^sukkot 1\b/.test(normalized)) return true;
  if (/shemini atzeret|shmini atzeret|simchat torah/.test(normalized)) return true;
  if (/^pesach i\b|^passover i\b/.test(normalized)) return true;
  if (/^pesach vii\b|^passover vii\b/.test(normalized)) return true;
  if (/^shavuot\b/.test(normalized)) return true;
  if (/yom ha['']?atzmaut|independence day/.test(normalized)) return true;

  return false;
}

export function getQualifyingHolidayNamesForDate(
  dateKey: string,
  holidayMap: Map<string, string[]>,
): string[] {
  return (holidayMap.get(dateKey) ?? []).filter(isQualifyingPremium150Holiday);
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

function sumWorkedMsByJerusalemDay(
  records: ClockInExportRecord[],
  nowMs: number,
): Map<string, number> {
  const byDay = new Map<string, number>();

  for (const record of records) {
    const start = new Date(record.clock_in_time).getTime();
    const end = record.clock_out_time ? new Date(record.clock_out_time).getTime() : nowMs;
    if (!Number.isFinite(start) || end <= start) continue;

    let cursor = start;
    while (cursor < end) {
      const dateKey = getJerusalemDateKeyFromMs(cursor);
      const dayEnd = jerusalemDayStartMs(addDaysToDateKey(dateKey, 1));
      const segmentEnd = Math.min(end, dayEnd);
      const chunkMs = segmentEnd - cursor;
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

function accumulateDailyAttendance(
  byDay: Map<string, number>,
  from: string,
  to: string,
  holidayMap: Map<string, string[]>,
  excludedDateKeys: Set<string>,
): { rawMissingMs: number; rawOvertime125Ms: number; rawOvertime150Ms: number } {
  let rawMissingMs = 0;
  let rawOvertime125Ms = 0;
  let rawOvertime150Ms = 0;

  for (const dateKey of eachDayInRange(from, to)) {
    const workedMs = byDay.get(dateKey) ?? 0;

    if (isDeficitTrackingWorkday(dateKey, holidayMap)) {
      if (excludedDateKeys.has(dateKey)) {
        // Sick / vacation day — no missing hours; any overtime still counts.
        if (workedMs > REQUIRED_DAILY_MS) {
          const { overtime125Ms, overtime150Ms } = splitOvertimeMs(workedMs - REQUIRED_DAILY_MS);
          rawOvertime125Ms += overtime125Ms;
          rawOvertime150Ms += overtime150Ms;
        }
        continue;
      }

      const dailyBalanceMs = workedMs - REQUIRED_DAILY_MS;
      if (dailyBalanceMs < 0) {
        rawMissingMs += -dailyBalanceMs;
      } else if (dailyBalanceMs > 0) {
        const { overtime125Ms, overtime150Ms } = splitOvertimeMs(dailyBalanceMs);
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
  entries: Array<Pick<EmployeeUnavailabilityEntry, 'unavailability_type' | 'start_date' | 'end_date'>>,
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
  entries: Array<Pick<EmployeeUnavailabilityEntry, 'unavailability_type' | 'start_date' | 'end_date'>>,
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
  unavailabilities: Array<Pick<EmployeeUnavailabilityEntry, 'unavailability_type' | 'start_date' | 'end_date'>> = [],
  nowMs = Date.now(),
): EmployeeExtraHoursTotals {
  const counted = filterCountedClockInRecords(records);
  const byDay = sumWorkedMsByJerusalemDay(counted, nowMs);
  const excludedDays = buildSickAndVacationDateKeys(unavailabilities, from, to, holidayMap);

  const { rawMissingMs, rawOvertime125Ms, rawOvertime150Ms } = accumulateDailyAttendance(
    byDay,
    from,
    to,
    holidayMap,
    excludedDays,
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

/** Build a merged holiday map for a date range (call preloadHolidayMapsForRange first). */
export function buildHolidayMapForRange(from: string, to: string): Map<string, string[]> {
  const years = new Set<number>();
  const [fromY] = from.split('-').map(Number);
  const [toY] = to.split('-').map(Number);
  if (Number.isFinite(fromY)) years.add(fromY);
  if (Number.isFinite(toY)) years.add(toY);

  const mergedHolidayMap = new Map<string, string[]>();
  for (const year of years) {
    const yearMap = getHolidaysForYearMap(year);
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
    Array<Pick<EmployeeUnavailabilityEntry, 'unavailability_type' | 'start_date' | 'end_date'>>
  > = new Map(),
  nowMs = Date.now(),
): Map<number, EmployeeExtraHoursTotals> {
  const result = new Map<number, EmployeeExtraHoursTotals>();
  for (const [employeeId, records] of recordsByEmployee) {
    const minHours = minHoursByEmployee.get(employeeId) ?? 8;
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
  return getHolidaysForYearMap(year);
}

export function calculateEmployeeExtraHoursForRange(
  records: ClockInExportRecord[],
  minHours: number,
  from: string,
  to: string,
  unavailabilities: Array<Pick<EmployeeUnavailabilityEntry, 'unavailability_type' | 'start_date' | 'end_date'>> = [],
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
