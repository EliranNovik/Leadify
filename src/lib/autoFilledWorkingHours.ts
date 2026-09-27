import { toDateInputValue } from './employeeClockInFormat';
import { isDeficitTrackingWorkday } from './employeeExtraHours';
import { normalizeEmployeeMinHours } from './employeeLeadReporting';
import {
  buildUnavailabilityDayEffects,
  type UnavailabilityDayEffectInput,
} from './employeeUnavailabilities';
import type { ClockInExportRecord } from './workingHoursExport';

const MS_PER_HOUR = 3_600_000;

/**
 * Auto-fill applies from this date onward only; everything before it keeps its real data,
 * so no day anyone already reported on can be restated.
 */
export const AUTO_FILL_START_DATE = '2026-09-27';

/** Wall-clock start of an auto-filled day. */
export const AUTO_FILL_START_HOUR = 9;

/**
 * A synthetic row has no database id, so anything that edits or deletes a day has to
 * recognise it and stay out of the way.
 */
export function isAutoFilledClockInRecord(
  record: { auto_filled?: boolean } | null | undefined,
): boolean {
  return record?.auto_filled === true;
}

/** True for a day whose only entries are auto-filled, including a day with no entries. */
export function isAutoFilledOnlyDay(
  dayRecords: Array<{ auto_filled?: boolean }>,
): boolean {
  return dayRecords.every(isAutoFilledClockInRecord);
}

const JERUSALEM_OFFSET_FORMATTER = new Intl.DateTimeFormat('en-US', {
  timeZone: 'Asia/Jerusalem',
  timeZoneName: 'longOffset',
});

/**
 * UTC offset in force in Jerusalem on this date, as "+03:00".
 *
 * Sampled at midday UTC, which is on the same side of the 02:00 local DST switch as
 * the 09:00 start, so the October changeover lands on the right offset.
 */
function jerusalemOffsetForDate(dateKey: string): string {
  const [year, month, day] = dateKey.split('-').map(Number);
  const parts = JERUSALEM_OFFSET_FORMATTER.formatToParts(
    new Date(Date.UTC(year, month - 1, day, 12)),
  );
  const label = parts.find((part) => part.type === 'timeZoneName')?.value ?? '';
  const match = /GMT([+-])(\d{1,2})(?::(\d{2}))?/.exec(label);
  if (!match) return '+02:00';
  const [, sign, hours, minutes] = match;
  return `${sign}${hours.padStart(2, '0')}:${minutes ?? '00'}`;
}

/** Render an instant as a local-time ISO string carrying the given offset. */
function isoWithOffset(ms: number, offset: string): string {
  const sign = offset.startsWith('-') ? -1 : 1;
  const [offsetHours, offsetMinutes] = offset.slice(1).split(':').map(Number);
  const shifted = new Date(ms + sign * (offsetHours * 60 + offsetMinutes) * 60_000);
  return `${shifted.toISOString().slice(0, 19)}${offset}`;
}

export type AutoFillOptions = {
  employeeId?: number | null;
  minHours: number;
  dateFrom: string;
  dateTo: string;
  /** Statutory days off, from buildHolidayMapForRange. */
  holidayMap: Map<string, string[]>;
  existingRecords: ClockInExportRecord[];
  unavailabilities?: UnavailabilityDayEffectInput[];
  /** Days after this are left empty. Defaults to today. */
  asOfDate?: string;
};

/**
 * Synthetic clock-in rows covering regular workdays the employee has no entry for.
 *
 * Fills min_hours from 09:00 on Sun–Thu, skipping the nine statutory holidays and
 * their eves, sick and vacation days, any day that already has a clock-in of its own,
 * and anything past today. Timed general absences shorten the day.
 */
export function buildAutoFilledClockInRecords(options: AutoFillOptions): ClockInExportRecord[] {
  const { dateFrom, dateTo, holidayMap, existingRecords } = options;

  const from = dateFrom > AUTO_FILL_START_DATE ? dateFrom : AUTO_FILL_START_DATE;
  const asOf = options.asOfDate ?? toDateInputValue(new Date());
  const to = dateTo < asOf ? dateTo : asOf;
  if (from > to) return [];

  const minHours = normalizeEmployeeMinHours(options.minHours);
  if (minHours <= 0) return [];

  // Any row at all, approved or not: an employee who reported the day owns it.
  const daysWithRecords = new Set(
    existingRecords.map((record) => toDateInputValue(new Date(record.clock_in_time))),
  );
  const absenceByDate = buildUnavailabilityDayEffects(options.unavailabilities ?? [], from, to);

  const records: ClockInExportRecord[] = [];

  for (let dateKey = from; dateKey <= to; dateKey = nextDateKey(dateKey)) {
    if (daysWithRecords.has(dateKey)) continue;
    if (!isDeficitTrackingWorkday(dateKey, holidayMap)) continue;

    const absence = absenceByDate.get(dateKey);
    if (absence?.fullDay) continue;

    const filledHours = minHours - (absence?.generalHours ?? 0);
    if (filledHours <= 0) continue;

    const offset = jerusalemOffsetForDate(dateKey);
    const startMs = Date.parse(
      `${dateKey}T${String(AUTO_FILL_START_HOUR).padStart(2, '0')}:00:00${offset}`,
    );
    if (!Number.isFinite(startMs)) continue;

    records.push({
      employee_id: options.employeeId ?? undefined,
      clock_in_time: isoWithOffset(startMs, offset),
      clock_out_time: isoWithOffset(startMs + Math.round(filledHours * MS_PER_HOUR), offset),
      notes: null,
      // Not manual, so it reads as auto-approved and needs nobody's sign-off.
      manually: false,
      approved: true,
      declined: false,
      auto_filled: true,
    });
  }

  return records;
}

function nextDateKey(dateKey: string): string {
  const [year, month, day] = dateKey.split('-').map(Number);
  const next = new Date(year, month - 1, day + 1);
  return toDateInputValue(next);
}

/** Real rows plus auto-filled rows for one employee. */
export function withAutoFilledClockInRecords(options: AutoFillOptions): ClockInExportRecord[] {
  return [...options.existingRecords, ...buildAutoFilledClockInRecords(options)];
}

export type AutoFillEmployeeContext = {
  minHours: number;
  unavailabilities?: UnavailabilityDayEffectInput[];
};

/**
 * Same fill applied across a multi-employee record set, keeping the flat shape the
 * report and export helpers expect.
 */
export function withAutoFilledClockInRecordsByEmployee(options: {
  records: ClockInExportRecord[];
  employees: Map<number, AutoFillEmployeeContext>;
  dateFrom: string;
  dateTo: string;
  holidayMap: Map<string, string[]>;
  asOfDate?: string;
}): ClockInExportRecord[] {
  const byEmployee = new Map<number, ClockInExportRecord[]>();
  for (const record of options.records) {
    const employeeId = record.employee_id;
    if (employeeId == null) continue;
    const list = byEmployee.get(employeeId);
    if (list) list.push(record);
    else byEmployee.set(employeeId, [record]);
  }

  const filled: ClockInExportRecord[] = [...options.records];

  for (const [employeeId, context] of options.employees) {
    filled.push(
      ...buildAutoFilledClockInRecords({
        employeeId,
        minHours: context.minHours,
        dateFrom: options.dateFrom,
        dateTo: options.dateTo,
        holidayMap: options.holidayMap,
        existingRecords: byEmployee.get(employeeId) ?? [],
        unavailabilities: context.unavailabilities,
        asOfDate: options.asOfDate,
      }),
    );
  }

  return filled;
}
