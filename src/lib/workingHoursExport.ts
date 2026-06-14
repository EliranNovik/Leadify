import * as XLSX from 'xlsx';
import { supabase } from './supabase';
import {
  dateRangeToIsoBounds,
  formatClockDate,
  formatClockTime,
  sumClockDurations,
  toDateInputValue,
} from './employeeClockInFormat';
import { resolveWorkplaceName } from './clockInLocations';
import {
  expandUnavailabilitiesToDailyRows,
  unavailabilityDateLabel,
  unavailabilityReasonText,
  unavailabilityTypeLabel,
  type EmployeeUnavailabilityEntry,
} from './employeeUnavailabilities';

export type ClockInExportRecord = {
  id?: number;
  employee_id?: number;
  clock_in_time: string;
  clock_out_time: string | null;
  notes: string | null;
  manually?: boolean;
  clock_in_location_id?: number | null;
  clock_out_location_id?: number | null;
  clock_in_place?: { name: string } | { name: string }[] | null;
  clock_out_place?: { name: string } | { name: string }[] | null;
  location_latitude?: number | null;
  location_longitude?: number | null;
  location_address?: string | null;
  location_city?: string | null;
  location_country?: string | null;
  clock_out_location_latitude?: number | null;
  clock_out_location_longitude?: number | null;
  clock_out_location_address?: string | null;
  clock_out_location_city?: string | null;
  clock_out_location_country?: string | null;
};

export type EmployeeWorkingHoursTotals = {
  totalDuration: string;
  daysWorked: number;
};

const CLOCK_IN_SELECT = `
  id, employee_id, clock_in_time, clock_out_time, notes, manually,
  clock_in_location_id, clock_out_location_id,
  clock_in_place:clock_in_locations!clock_in_location_id ( name ),
  clock_out_place:clock_in_locations!clock_out_location_id ( name )
`;

const CLOCK_IN_DETAIL_SELECT = `
  ${CLOCK_IN_SELECT.trim()},
  location_latitude, location_longitude, location_address, location_city, location_country,
  clock_out_location_latitude, clock_out_location_longitude,
  clock_out_location_address, clock_out_location_city, clock_out_location_country
`;

export function computeWorkingHoursTotals(
  records: ClockInExportRecord[],
): EmployeeWorkingHoursTotals {
  if (records.length === 0) {
    return { totalDuration: '0h 0m', daysWorked: 0 };
  }
  const dayKeys = new Set(
    records.map((r) => toDateInputValue(new Date(r.clock_in_time))),
  );
  return {
    totalDuration: sumClockDurations(records),
    daysWorked: dayKeys.size,
  };
}

export async function fetchEmployeeClockInRecords(
  employeeId: number,
  dateFrom: string,
  dateTo: string,
): Promise<ClockInExportRecord[]> {
  const { start, end } = dateRangeToIsoBounds(dateFrom, dateTo);
  const { data, error } = await supabase
    .from('employee_clock_in')
    .select(CLOCK_IN_DETAIL_SELECT)
    .eq('employee_id', employeeId)
    .gte('clock_in_time', start)
    .lte('clock_in_time', end)
    .order('clock_in_time', { ascending: false });

  if (error) throw error;
  return (data as ClockInExportRecord[]) || [];
}

export type ClockInWithEmployee = ClockInExportRecord & {
  tenants_employee?: {
    display_name: string | null;
    photo_url: string | null;
    department_id?: number | null;
    tenant_departement?: { name: string } | { name: string }[] | null;
  } | {
    display_name: string | null;
    photo_url: string | null;
    department_id?: number | null;
    tenant_departement?: { name: string } | { name: string }[] | null;
  }[] | null;
};

/** All clock-in rows in range, with employee profile for report merging. */
export async function fetchClockInRecordsInRange(
  dateFrom: string,
  dateTo: string,
): Promise<ClockInWithEmployee[]> {
  const { start, end } = dateRangeToIsoBounds(dateFrom, dateTo);
  const { data, error } = await supabase
    .from('employee_clock_in')
    .select(
      `${CLOCK_IN_SELECT},
       tenants_employee!employee_id (
         display_name, photo_url, department_id,
         tenant_departement!department_id ( name )
       )`,
    )
    .gte('clock_in_time', start)
    .lte('clock_in_time', end)
    .order('clock_in_time', { ascending: false });

  if (error) throw error;
  return (data as ClockInWithEmployee[]) || [];
}

export function groupClockInTotalsByEmployee(
  records: ClockInWithEmployee[],
): Map<number, { totals: EmployeeWorkingHoursTotals; records: ClockInExportRecord[] }> {
  const map = new Map<number, { totals: EmployeeWorkingHoursTotals; records: ClockInExportRecord[] }>();
  const byEmployee = new Map<number, ClockInExportRecord[]>();

  for (const row of records) {
    const empId = row.employee_id;
    if (empId == null) continue;
    const list = byEmployee.get(empId);
    if (list) list.push(row);
    else byEmployee.set(empId, [row]);
  }

  for (const [empId, empRecords] of byEmployee) {
    map.set(empId, {
      totals: computeWorkingHoursTotals(empRecords),
      records: empRecords,
    });
  }
  return map;
}

function sanitizeFilenamePart(value: string): string {
  return value.replace(/[^\w\-]+/g, '_').replace(/_+/g, '_').slice(0, 60);
}

export type DailyClockInSummary = {
  dateKey: string;
  date: string;
  clockIns: string;
  clockOuts: string;
  totalDuration: string;
  workplacesIn: string;
  workplacesOut: string;
  notes: string;
  hasManual: boolean;
  hasAutomatic: boolean;
};

function msToDurationLabel(totalMs: number): string {
  const hours = Math.floor(totalMs / (1000 * 60 * 60));
  const minutes = Math.floor((totalMs % (1000 * 60 * 60)) / (1000 * 60));
  return `${hours}h ${minutes}m`;
}

/** One row per calendar day — merges all sessions on that day. */
export function aggregateClockInRecordsByDay(
  records: ClockInExportRecord[],
): DailyClockInSummary[] {
  const byDay = new Map<string, ClockInExportRecord[]>();

  for (const record of records) {
    const key = toDateInputValue(new Date(record.clock_in_time));
    const bucket = byDay.get(key);
    if (bucket) bucket.push(record);
    else byDay.set(key, [record]);
  }

  const summaries: DailyClockInSummary[] = [];
  const now = Date.now();

  for (const [dateKey, dayRecords] of byDay) {
    dayRecords.sort(
      (a, b) => new Date(a.clock_in_time).getTime() - new Date(b.clock_in_time).getTime(),
    );

    let totalMs = 0;
    const clockInTimes: string[] = [];
    const clockOutTimes: string[] = [];
    const workplacesInSet = new Set<string>();
    const workplacesOutSet = new Set<string>();
    const notesList: string[] = [];
    let hasManual = false;
    let hasAutomatic = false;

    for (const row of dayRecords) {
      if (row.manually) hasManual = true;
      else hasAutomatic = true;

      clockInTimes.push(formatClockTime(row.clock_in_time));
      clockOutTimes.push(
        row.clock_out_time ? formatClockTime(row.clock_out_time) : 'Active',
      );

      const start = new Date(row.clock_in_time).getTime();
      const end = row.clock_out_time ? new Date(row.clock_out_time).getTime() : now;
      totalMs += Math.max(0, end - start);

      const wpIn = resolveWorkplaceName(row, 'in');
      if (wpIn !== '—') workplacesInSet.add(wpIn);

      if (row.clock_out_time) {
        const wpOut = resolveWorkplaceName(row, 'out');
        if (wpOut !== '—') workplacesOutSet.add(wpOut);
      }

      const note = row.notes?.trim();
      if (note) notesList.push(note);
    }

    summaries.push({
      dateKey,
      date: formatClockDate(dayRecords[0].clock_in_time),
      clockIns: clockInTimes.join(', '),
      clockOuts: clockOutTimes.join(', '),
      totalDuration: msToDurationLabel(totalMs),
      workplacesIn: workplacesInSet.size > 0 ? [...workplacesInSet].join(', ') : '—',
      workplacesOut: workplacesOutSet.size > 0 ? [...workplacesOutSet].join(', ') : '—',
      notes: notesList.length > 0 ? notesList.join('; ') : '—',
      hasManual,
      hasAutomatic,
    });
  }

  summaries.sort((a, b) => b.dateKey.localeCompare(a.dateKey));
  return summaries;
}

const EXPORT_COLUMNS = [
  'Employee',
  'Date',
  'Clock in',
  'Clock out',
  'Total duration',
  'Workplace (in)',
  'Workplace (out)',
  'Notes',
] as const;

export function exportWorkingHoursToExcel(
  dailyRows: DailyClockInSummary[],
  options: {
    employeeName: string;
    dateFrom: string;
    dateTo: string;
    periodTotal: string;
    filenameSuffix?: string;
  },
): void {
  const employee = options.employeeName.trim() || '—';

  const rows = dailyRows.map((row) => ({
    Employee: employee,
    Date: row.date,
    'Clock in': row.clockIns,
    'Clock out': row.clockOuts,
    'Total duration': row.totalDuration,
    'Workplace (in)': row.workplacesIn,
    'Workplace (out)': row.workplacesOut,
    Notes: row.notes,
  }));

  rows.push({
    Employee: '',
    Date: '',
    'Clock in': '',
    'Clock out': '',
    'Total duration': '',
    'Workplace (in)': '',
    'Workplace (out)': '',
    Notes: '',
  });
  rows.push({
    Employee: '',
    Date: `Period total (${options.dateFrom} – ${options.dateTo})`,
    'Clock in': '',
    'Clock out': '',
    'Total duration': options.periodTotal,
    'Workplace (in)': '',
    'Workplace (out)': '',
    Notes: '',
  });

  const ws = XLSX.utils.json_to_sheet(rows, { header: [...EXPORT_COLUMNS] });
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Working Hours');
  const namePart = options.filenameSuffix
    ? `${sanitizeFilenamePart(options.filenameSuffix)}_`
    : '';
  const filename = `working_hours_${namePart}${options.dateFrom}_to_${options.dateTo}.xlsx`;
  XLSX.writeFile(wb, filename);
}

export type MergedTimeUnavailabilityExportRow = {
  dateKey: string;
  date: string;
  unavailability: string;
  unavailabilityReason: string;
  clockIns: string;
  clockOuts: string;
  totalDuration: string;
  workplacesIn: string;
  workplacesOut: string;
  source: string;
  notes: string;
};

function clockSourceLabel(hasManual: boolean, hasAutomatic: boolean): string {
  if (hasManual && hasAutomatic) return 'Manual, Automatic';
  if (hasManual) return 'Manual';
  if (hasAutomatic) return 'Automatic';
  return '—';
}

/** One Excel row per calendar day — clock-in/out and unavailabilities on the same date merged. */
export function buildMergedTimeAndUnavailabilityExportRows(
  clockRecords: ClockInExportRecord[],
  unavailabilities: EmployeeUnavailabilityEntry[],
  dateFrom: string,
  dateTo: string,
): MergedTimeUnavailabilityExportRow[] {
  const dailyClock = aggregateClockInRecordsByDay(clockRecords);
  const clockByDate = new Map(dailyClock.map((row) => [row.dateKey, row]));

  const unavailByDate = new Map<string, { types: string[]; reasons: string[] }>();
  for (const row of expandUnavailabilitiesToDailyRows(unavailabilities, dateFrom, dateTo)) {
    const type = unavailabilityTypeLabel(row.unavailability_type);
    const reason = unavailabilityReasonText(row);
    const reasonText = reason === '—' ? '' : reason;
    const bucket = unavailByDate.get(row.date);
    if (bucket) {
      if (!bucket.types.includes(type)) bucket.types.push(type);
      if (reasonText && !bucket.reasons.includes(reasonText)) bucket.reasons.push(reasonText);
    } else {
      unavailByDate.set(row.date, {
        types: [type],
        reasons: reasonText ? [reasonText] : [],
      });
    }
  }

  const allDateKeys = new Set([...clockByDate.keys(), ...unavailByDate.keys()]);
  const rows: MergedTimeUnavailabilityExportRow[] = [];

  for (const dateKey of allDateKeys) {
    const clock = clockByDate.get(dateKey);
    const unavail = unavailByDate.get(dateKey);
    rows.push({
      dateKey,
      date: clock?.date ?? unavailabilityDateLabel(dateKey),
      unavailability: unavail ? unavail.types.join(', ') : '—',
      unavailabilityReason:
        unavail && unavail.reasons.length > 0 ? unavail.reasons.join('; ') : '—',
      clockIns: clock?.clockIns ?? '—',
      clockOuts: clock?.clockOuts ?? '—',
      totalDuration: clock?.totalDuration ?? '—',
      workplacesIn: clock?.workplacesIn ?? '—',
      workplacesOut: clock?.workplacesOut ?? '—',
      source: clock ? clockSourceLabel(clock.hasManual, clock.hasAutomatic) : '—',
      notes: clock?.notes ?? '—',
    });
  }

  rows.sort((a, b) => b.dateKey.localeCompare(a.dateKey));
  return rows;
}

const MERGED_EXPORT_COLUMNS = [
  'Employee',
  'Date',
  'Unavailability',
  'Unavailability reason',
  'Clock in',
  'Clock out',
  'Total duration',
  'Workplace (in)',
  'Workplace (out)',
  'Source',
  'Notes',
] as const;

export function exportMergedTimeAndUnavailabilitiesToExcel(
  mergedRows: MergedTimeUnavailabilityExportRow[],
  options: {
    employeeName: string;
    dateFrom: string;
    dateTo: string;
    periodTotal: string;
    filenameSuffix?: string;
  },
): void {
  const employee = options.employeeName.trim() || '—';

  const rows = mergedRows.map((row) => ({
    Employee: employee,
    Date: row.date,
    Unavailability: row.unavailability,
    'Unavailability reason': row.unavailabilityReason,
    'Clock in': row.clockIns,
    'Clock out': row.clockOuts,
    'Total duration': row.totalDuration,
    'Workplace (in)': row.workplacesIn,
    'Workplace (out)': row.workplacesOut,
    Source: row.source,
    Notes: row.notes,
  }));

  rows.push({
    Employee: '',
    Date: '',
    Unavailability: '',
    'Unavailability reason': '',
    'Clock in': '',
    'Clock out': '',
    'Total duration': '',
    'Workplace (in)': '',
    'Workplace (out)': '',
    Source: '',
    Notes: '',
  });
  rows.push({
    Employee: '',
    Date: `Period total (${options.dateFrom} – ${options.dateTo})`,
    Unavailability: '',
    'Unavailability reason': '',
    'Clock in': '',
    'Clock out': '',
    'Total duration': options.periodTotal,
    'Workplace (in)': '',
    'Workplace (out)': '',
    Source: '',
    Notes: '',
  });

  const ws = XLSX.utils.json_to_sheet(rows, { header: [...MERGED_EXPORT_COLUMNS] });
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Time & Unavailabilities');
  const namePart = options.filenameSuffix
    ? `${sanitizeFilenamePart(options.filenameSuffix)}_`
    : '';
  const filename = `time_unavailabilities_${namePart}${options.dateFrom}_to_${options.dateTo}.xlsx`;
  XLSX.writeFile(wb, filename);
}
