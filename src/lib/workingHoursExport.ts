import * as XLSX from 'xlsx';
import { supabase } from './supabase';
import {
  dateRangeToIsoBounds,
  formatClockTime,
  formatWorkingHoursDateLabel,
  sumClockDurations,
  toDateInputValue,
} from './employeeClockInFormat';
import { resolveWorkplaceName } from './clockInLocations';
import { formatClockInLocationDisplay } from './employeeClockInLocation';
import {
  expandUnavailabilitiesToDailyRows,
  unavailabilityDateLabel,
  unavailabilityReasonText,
  unavailabilityTypeLabel,
  type EmployeeUnavailabilityEntry,
} from './employeeUnavailabilities';
import { isClockInRecordCounted } from './employeeClockInApproval';

export type ClockInExportRecord = {
  id?: number;
  employee_id?: number;
  clock_in_time: string;
  clock_out_time: string | null;
  notes: string | null;
  manually?: boolean;
  approved?: boolean;
  declined?: boolean;
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
  id, employee_id, clock_in_time, clock_out_time, notes, manually, approved, declined,
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
  const counted = records.filter(isClockInRecordCounted);
  if (counted.length === 0) {
    return { totalDuration: '0h 0m', daysWorked: 0 };
  }
  const dayKeys = new Set(
    counted.map((r) => toDateInputValue(new Date(r.clock_in_time))),
  );
  return {
    totalDuration: sumClockDurations(counted),
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
      `${CLOCK_IN_DETAIL_SELECT},
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

function sanitizeSheetName(value: string, usedNames: Set<string>): string {
  const invalidChars = /[\\/?*[\]:]/g;
  let base = value.replace(invalidChars, '').trim().slice(0, 31) || 'Employee';
  let name = base;
  let counter = 2;
  while (usedNames.has(name.toLowerCase())) {
    const suffix = ` (${counter})`;
    name = `${base.slice(0, Math.max(1, 31 - suffix.length))}${suffix}`;
    counter += 1;
  }
  usedNames.add(name.toLowerCase());
  return name;
}

export type ClockSessionSummary = {
  clockIn: string;
  clockOut: string;
  workplaceIn: string;
  workplaceOut: string;
  gpsIn: string;
  gpsOut: string;
};

export type DailyClockInSummary = {
  dateKey: string;
  date: string;
  clockIns: string;
  clockOuts: string;
  sessions: ClockSessionSummary[];
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

function parseDateKeyMs(dateKey: string): number {
  const [y, m, d] = dateKey.split('-').map(Number);
  return new Date(y, m - 1, d).getTime();
}

function sortDateKeysAsc(a: string, b: string): number {
  return parseDateKeyMs(a) - parseDateKeyMs(b);
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
    const sessions: ClockSessionSummary[] = [];
    const workplacesInSet = new Set<string>();
    const workplacesOutSet = new Set<string>();
    const notesList: string[] = [];
    let hasManual = false;
    let hasAutomatic = false;

    for (const row of dayRecords) {
      if (row.manually) hasManual = true;
      else hasAutomatic = true;

      clockInTimes.push(formatClockTime(row.clock_in_time));
      const clockOutLabel = row.clock_out_time ? formatClockTime(row.clock_out_time) : 'Active';
      clockOutTimes.push(clockOutLabel);

      const wpIn = resolveWorkplaceName(row, 'in');
      const wpOut = row.clock_out_time ? resolveWorkplaceName(row, 'out') : '—';

      sessions.push({
        clockIn: formatClockTime(row.clock_in_time),
        clockOut: clockOutLabel,
        workplaceIn: wpIn,
        workplaceOut: wpOut,
        gpsIn: formatClockInLocationDisplay(row, 'in'),
        gpsOut: row.clock_out_time ? formatClockInLocationDisplay(row, 'out') : '—',
      });

      const start = new Date(row.clock_in_time).getTime();
      const end = row.clock_out_time ? new Date(row.clock_out_time).getTime() : now;
      if (isClockInRecordCounted(row)) {
        totalMs += Math.max(0, end - start);
      }

      if (wpIn !== '—') workplacesInSet.add(wpIn);
      if (wpOut !== '—') workplacesOutSet.add(wpOut);

      const note = row.notes?.trim();
      if (note) notesList.push(note);
    }

    summaries.push({
      dateKey,
      date: formatWorkingHoursDateLabel(dateKey),
      clockIns: clockInTimes.join(', '),
      clockOuts: clockOutTimes.join(', '),
      sessions,
      totalDuration: msToDurationLabel(totalMs),
      workplacesIn: workplacesInSet.size > 0 ? [...workplacesInSet].join(', ') : '—',
      workplacesOut: workplacesOutSet.size > 0 ? [...workplacesOutSet].join(', ') : '—',
      notes: notesList.length > 0 ? notesList.join('; ') : '—',
      hasManual,
      hasAutomatic,
    });
  }

  summaries.sort((a, b) => sortDateKeysAsc(a.dateKey, b.dateKey));
  return summaries;
}

function maxClockSessionsCount(sessionLists: ClockSessionSummary[][]): number {
  return sessionLists.reduce((max, sessions) => Math.max(max, sessions.length), 0);
}

function clockSessionColumnHeaders(maxSessions: number): string[] {
  const cols: string[] = [];
  for (let i = 1; i <= maxSessions; i++) {
    cols.push(
      `Clock in ${i}`,
      `Clock out ${i}`,
      `Workplace (in) ${i}`,
      `Workplace (out) ${i}`,
      `GPS (in) ${i}`,
      `GPS (out) ${i}`,
    );
  }
  return cols;
}

function clockSessionColumnValues(
  sessions: ClockSessionSummary[],
  maxSessions: number,
): Record<string, string> {
  const values: Record<string, string> = {};
  for (let i = 0; i < maxSessions; i++) {
    const n = i + 1;
    const session = sessions[i];
    values[`Clock in ${n}`] = session?.clockIn ?? '';
    values[`Clock out ${n}`] = session?.clockOut ?? '';
    values[`Workplace (in) ${n}`] = session?.workplaceIn ?? '';
    values[`Workplace (out) ${n}`] = session?.workplaceOut ?? '';
    values[`GPS (in) ${n}`] = session?.gpsIn ?? '';
    values[`GPS (out) ${n}`] = session?.gpsOut ?? '';
  }
  return values;
}

function emptyClockSessionColumnValues(maxSessions: number): Record<string, string> {
  return clockSessionColumnValues([], maxSessions);
}

const EXPORT_STATIC_COLUMNS_AFTER_CLOCK = [
  'Total duration',
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
  const maxSessions = Math.max(1, maxClockSessionsCount(dailyRows.map((row) => row.sessions)));
  const clockColumns = clockSessionColumnHeaders(maxSessions);
  const exportColumns = ['Employee', 'Date', ...clockColumns, ...EXPORT_STATIC_COLUMNS_AFTER_CLOCK];

  const rows = dailyRows.map((row) => ({
    Employee: employee,
    Date: row.date,
    ...clockSessionColumnValues(row.sessions, maxSessions),
    'Total duration': row.totalDuration,
    Notes: row.notes,
  }));

  rows.push({
    Employee: '',
    Date: '',
    ...emptyClockSessionColumnValues(maxSessions),
    'Total duration': '',
    Notes: '',
  });
  rows.push({
    Employee: '',
    Date: `Period total (${unavailabilityDateLabel(options.dateFrom)} – ${unavailabilityDateLabel(options.dateTo)})`,
    ...emptyClockSessionColumnValues(maxSessions),
    'Total duration': options.periodTotal,
    Notes: '',
  });

  const ws = XLSX.utils.json_to_sheet(rows, { header: exportColumns });
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
  clockSessions: ClockSessionSummary[];
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
      date: formatWorkingHoursDateLabel(dateKey),
      unavailability: unavail ? unavail.types.join(', ') : '—',
      unavailabilityReason:
        unavail && unavail.reasons.length > 0 ? unavail.reasons.join('; ') : '—',
      clockSessions: clock?.sessions ?? [],
      clockIns: clock?.clockIns ?? '—',
      clockOuts: clock?.clockOuts ?? '—',
      totalDuration: clock?.totalDuration ?? '—',
      workplacesIn: clock?.workplacesIn ?? '—',
      workplacesOut: clock?.workplacesOut ?? '—',
      source: clock ? clockSourceLabel(clock.hasManual, clock.hasAutomatic) : '—',
      notes: clock?.notes ?? '—',
    });
  }

  rows.sort((a, b) => sortDateKeysAsc(a.dateKey, b.dateKey));
  return rows;
}

const MERGED_EXPORT_STATIC_COLUMNS_AFTER_CLOCK = [
  'Total duration',
  'Source',
  'Notes',
] as const;

export type EmployeeMergedTimeUnavailabilityExportRow = MergedTimeUnavailabilityExportRow & {
  employeeName: string;
  department: string;
};

export function buildEmployeeMergedTimeAndUnavailabilityExportRows(
  clockRecords: ClockInExportRecord[],
  unavailabilities: EmployeeUnavailabilityEntry[],
  dateFrom: string,
  dateTo: string,
  employeeName: string,
  department: string,
): EmployeeMergedTimeUnavailabilityExportRow[] {
  const rows = buildMergedTimeAndUnavailabilityExportRows(
    clockRecords,
    unavailabilities,
    dateFrom,
    dateTo,
  ).map((row) => ({
    ...row,
    employeeName,
    department,
  }));

  if (rows.length > 0) {
    return rows;
  }

  return [
    {
      employeeName,
      department,
      dateKey: dateFrom,
      date: '—',
      unavailability: '—',
      unavailabilityReason: '—',
      clockSessions: [],
      clockIns: '—',
      clockOuts: '—',
      totalDuration: '—',
      workplacesIn: '—',
      workplacesOut: '—',
      source: '—',
      notes: '—',
    },
  ];
}

export type EmployeeTimeUnavailabilityExportBundle = {
  employeeName: string;
  department: string;
  rows: MergedTimeUnavailabilityExportRow[];
  periodTotal: string;
};

export function exportAllEmployeesMergedTimeAndUnavailabilitiesToExcel(
  employees: EmployeeTimeUnavailabilityExportBundle[],
  options: {
    dateFrom: string;
    dateTo: string;
    filenameSuffix?: string;
  },
): void {
  const wb = XLSX.utils.book_new();
  const usedSheetNames = new Set<string>();

  for (const employee of employees) {
    const sortedRows = [...employee.rows].sort((a, b) => sortDateKeysAsc(a.dateKey, b.dateKey));
    const maxSessions = Math.max(1, maxClockSessionsCount(sortedRows.map((row) => row.clockSessions)));
    const { exportColumns, rows } = buildMergedExportSheetRows(
      sortedRows.map((row) => ({
        ...row,
        employeeName: employee.employeeName,
        department: employee.department,
      })),
      maxSessions,
      {
        includeEmployeeColumns: true,
        periodTotal: employee.periodTotal,
        dateFrom: options.dateFrom,
        dateTo: options.dateTo,
      },
    );

    const ws = XLSX.utils.json_to_sheet(rows, { header: exportColumns });
    const sheetName = sanitizeSheetName(employee.employeeName, usedSheetNames);
    XLSX.utils.book_append_sheet(wb, ws, sheetName);
  }

  const namePart = options.filenameSuffix
    ? `${sanitizeFilenamePart(options.filenameSuffix)}_`
    : '';
  const filename = `employee_time_unavailabilities_${namePart}${options.dateFrom}_to_${options.dateTo}.xlsx`;
  XLSX.writeFile(wb, filename);
}

function buildMergedExportSheetRows(
  mergedRows: Array<MergedTimeUnavailabilityExportRow & { employeeName?: string; department?: string }>,
  maxSessions: number,
  options: {
    includeEmployeeColumns: boolean;
    periodTotal?: string;
    dateFrom?: string;
    dateTo?: string;
  },
): { exportColumns: string[]; rows: Record<string, string>[] } {
  const leadingColumns = options.includeEmployeeColumns
    ? ['Employee', 'Department']
    : [];
  const exportColumns = [
    ...leadingColumns,
    'Date',
    'Unavailability',
    'Unavailability reason',
    ...clockSessionColumnHeaders(maxSessions),
    ...MERGED_EXPORT_STATIC_COLUMNS_AFTER_CLOCK,
  ];

  const rows = mergedRows.map((row) => ({
    ...(options.includeEmployeeColumns
      ? {
          Employee: row.employeeName?.trim() || '—',
          Department: row.department?.trim() || '—',
        }
      : {}),
    Date: row.date,
    Unavailability: row.unavailability,
    'Unavailability reason': row.unavailabilityReason,
    ...clockSessionColumnValues(row.clockSessions, maxSessions),
    'Total duration': row.totalDuration,
    Source: row.source,
    Notes: row.notes,
  }));

  if (options.periodTotal && options.dateFrom && options.dateTo) {
    rows.push({
      ...(options.includeEmployeeColumns ? { Employee: '', Department: '' } : {}),
      Date: '',
      Unavailability: '',
      'Unavailability reason': '',
      ...emptyClockSessionColumnValues(maxSessions),
      'Total duration': '',
      Source: '',
      Notes: '',
    });
    rows.push({
      ...(options.includeEmployeeColumns ? { Employee: '', Department: '' } : {}),
      Date: `Period total (${unavailabilityDateLabel(options.dateFrom)} – ${unavailabilityDateLabel(options.dateTo)})`,
      Unavailability: '',
      'Unavailability reason': '',
      ...emptyClockSessionColumnValues(maxSessions),
      'Total duration': options.periodTotal,
      Source: '',
      Notes: '',
    });
  }

  return { exportColumns, rows };
}

export function exportMergedTimeAndUnavailabilitiesToExcel(
  mergedRows: MergedTimeUnavailabilityExportRow[],
  options: {
    employeeName: string;
    department?: string;
    dateFrom: string;
    dateTo: string;
    periodTotal: string;
    filenameSuffix?: string;
  },
): void {
  const maxSessions = Math.max(1, maxClockSessionsCount(mergedRows.map((row) => row.clockSessions)));
  const { exportColumns, rows } = buildMergedExportSheetRows(
    mergedRows.map((row) => ({
      ...row,
      employeeName: options.employeeName,
      department: options.department ?? '',
    })),
    maxSessions,
    {
      includeEmployeeColumns: true,
      periodTotal: options.periodTotal,
      dateFrom: options.dateFrom,
      dateTo: options.dateTo,
    },
  );

  const ws = XLSX.utils.json_to_sheet(rows, { header: exportColumns });
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Time & Unavailabilities');
  const namePart = options.filenameSuffix
    ? `${sanitizeFilenamePart(options.filenameSuffix)}_`
    : '';
  const filename = `time_unavailabilities_${namePart}${options.dateFrom}_to_${options.dateTo}.xlsx`;
  XLSX.writeFile(wb, filename);
}
