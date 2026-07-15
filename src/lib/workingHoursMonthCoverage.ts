import {
  eachDayInRange,
  isIsraeliWorkdayIso,
  monthRange,
  toDateInputValue,
} from './employeeClockInFormat';
import { getHolidaysForYearMap } from './israeliJewishHolidays';
import { expandUnavailabilitiesToDailyRows } from './employeeUnavailabilities';
import type { EmployeeUnavailabilityEntry } from './employeeUnavailabilities';

export type WorkingHoursDayCoverageStatus =
  | 'filled'
  | 'missing'
  | 'weekend'
  | 'holiday'
  | 'future';

export type WorkingHoursDayCoverage = {
  dateKey: string;
  status: WorkingHoursDayCoverageStatus;
  hasPendingApproval: boolean;
  holidayNames: string[];
};

export type WorkingHoursMonthCoverage = {
  days: WorkingHoursDayCoverage[];
  missingCount: number;
  coveredDates: Set<string>;
};

type ClockInDateSource = { clock_in_time: string };

function buildCoveredDates(
  year: number,
  month: number,
  records: ClockInDateSource[],
  unavailabilities: EmployeeUnavailabilityEntry[],
): Set<string> {
  const range = monthRange(year, month);
  const covered = new Set<string>();
  for (const record of records) {
    covered.add(toDateInputValue(new Date(record.clock_in_time)));
  }
  for (const row of expandUnavailabilitiesToDailyRows(
    unavailabilities,
    range.from,
    range.to,
  )) {
    covered.add(row.date);
  }
  return covered;
}

export function countMissingEntryDaysFromCoverage(
  days: WorkingHoursDayCoverage[],
): number {
  return days.filter((d) => d.status === 'missing' || d.status === 'holiday').length;
}

export function buildWorkingHoursMonthCoverage(
  year: number,
  month: number,
  records: ClockInDateSource[],
  unavailabilities: EmployeeUnavailabilityEntry[],
  options?: {
    asOfDate?: string;
    pendingApprovalDates?: Iterable<string>;
  },
): WorkingHoursMonthCoverage {
  const asOfDate = options?.asOfDate ?? toDateInputValue(new Date());
  const pendingApproval = new Set(options?.pendingApprovalDates ?? []);
  const covered = buildCoveredDates(year, month, records, unavailabilities);
  const { from, to } = monthRange(year, month);
  const holidayMap = getHolidaysForYearMap(year);

  const days: WorkingHoursDayCoverage[] = [];

  for (const day of eachDayInRange(from, to)) {
    const holidayNames = [...(holidayMap.get(day) ?? [])];
    let status: WorkingHoursDayCoverageStatus;

    if (!isIsraeliWorkdayIso(day)) {
      // Fri/Sat always shown as weekend (never count as missing), even if future.
      status = 'weekend';
    } else if (day > asOfDate) {
      status = 'future';
    } else if (covered.has(day)) {
      status = 'filled';
    } else if (holidayNames.length > 0) {
      // Sun–Thu holidays may still require clock-in / unavailability.
      status = 'holiday';
    } else {
      status = 'missing';
    }

    days.push({
      dateKey: day,
      status,
      hasPendingApproval: pendingApproval.has(day),
      holidayNames,
    });
  }

  const missingCount = countMissingEntryDaysFromCoverage(days);

  return { days, missingCount, coveredDates: covered };
}
