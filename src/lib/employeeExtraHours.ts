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
export const DAILY_PREMIUM_150_HOUR_THRESHOLD = 10;
const DAILY_PREMIUM_150_THRESHOLD_MS = DAILY_PREMIUM_150_HOUR_THRESHOLD * MS_PER_HOUR;

export type EmployeeExtraHoursTotals = {
  extraHours125Ms: number;
  extraHours150Ms: number;
  deficitHoursMs: number;
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

function isSaturday(dateKey: string): boolean {
  return getJerusalemDayOfWeek(dateKey) === 6;
}

/** Holidays that qualify for 150% per company rules (Hebcal titles). */
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

export function dayHasPremium150Holiday(
  dateKey: string,
  holidayMap: Map<string, string[]>,
): boolean {
  const names = holidayMap.get(dateKey) ?? [];
  return names.some(isQualifyingPremium150Holiday);
}

function isPremium150Day(dateKey: string, holidayMap: Map<string, string[]>): boolean {
  if (isSaturday(dateKey)) return true;
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

function finalizeExtraHoursFromDayTotals(
  byDay: Map<string, number>,
  minHours: number,
  holidayMap: Map<string, string[]>,
): Pick<EmployeeExtraHoursTotals, 'extraHours125Ms' | 'extraHours150Ms'> {
  const minMs = normalizeEmployeeMinHours(minHours) * MS_PER_HOUR;
  let extraHours150Ms = 0;
  let extraHours125Ms = 0;

  for (const [dateKey, totalDayMs] of byDay) {
    const extraAboveMinMs = Math.max(0, totalDayMs - minMs);
    if (extraAboveMinMs <= 0) continue;

    if (isPremium150Day(dateKey, holidayMap)) {
      extraHours150Ms += extraAboveMinMs;
      continue;
    }

    // Regular weekday (incl. Friday): above min_hours up to 10h/day → 125%; above 10h/day → 150%
    const premium150StartMs = Math.max(minMs, DAILY_PREMIUM_150_THRESHOLD_MS);
    const extra150Ms = Math.max(0, totalDayMs - premium150StartMs);
    const extra125Ms = extraAboveMinMs - extra150Ms;

    extraHours150Ms += extra150Ms;
    extraHours125Ms += extra125Ms;
  }

  return {
    extraHours125Ms,
    extraHours150Ms,
  };
}

/** Sun–Thu workdays excluding the nine qualifying premium holidays. */
function isDeficitTrackingWorkday(
  dateKey: string,
  holidayMap: Map<string, string[]>,
): boolean {
  if (!isIsraeliWorkdayIso(dateKey)) return false;
  return !dayHasPremium150Holiday(dateKey, holidayMap);
}

function calculateDeficitHoursMs(
  byDay: Map<string, number>,
  minHours: number,
  from: string,
  to: string,
  holidayMap: Map<string, string[]>,
  excludedDateKeys: Set<string> = new Set(),
): number {
  const minMs = normalizeEmployeeMinHours(minHours) * MS_PER_HOUR;
  let expectedMs = 0;
  let actualMs = 0;

  for (const dateKey of eachDayInRange(from, to)) {
    if (!isDeficitTrackingWorkday(dateKey, holidayMap)) continue;
    if (excludedDateKeys.has(dateKey)) continue;
    expectedMs += minMs;
    actualMs += byDay.get(dateKey) ?? 0;
  }

  return Math.max(0, expectedMs - actualMs);
}

export function buildSickAndVacationDateKeys(
  entries: Array<Pick<EmployeeUnavailabilityEntry, 'unavailability_type' | 'start_date' | 'end_date'>>,
  from: string,
  to: string,
): Set<string> {
  const keys = new Set<string>();
  for (const row of expandUnavailabilitiesToDailyRows(entries as EmployeeUnavailabilityEntry[], from, to)) {
    if (row.unavailability_type === 'sick_days' || row.unavailability_type === 'vacation') {
      keys.add(row.date);
    }
  }
  return keys;
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
  const extraTotals = finalizeExtraHoursFromDayTotals(byDay, minHours, holidayMap);
  const excludedDays = buildSickAndVacationDateKeys(unavailabilities, from, to);
  return {
    ...extraTotals,
    deficitHoursMs: calculateDeficitHoursMs(byDay, minHours, from, to, holidayMap, excludedDays),
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
