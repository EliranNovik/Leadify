import * as XLSX from 'xlsx-js-style';
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

const CLOCK_IN_REPORT_SELECT = `
  id, employee_id, clock_in_time, clock_out_time, manually, approved, declined
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
    min_hours?: number | null;
    hour_rate?: number | null;
    tenant_departement?: { name: string } | { name: string }[] | null;
  } | {
    display_name: string | null;
    photo_url: string | null;
    department_id?: number | null;
    min_hours?: number | null;
    hour_rate?: number | null;
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
         display_name, photo_url, department_id, min_hours, hour_rate,
         tenant_departement!department_id ( name )
       )`,
    )
    .gte('clock_in_time', start)
    .lte('clock_in_time', end)
    .order('clock_in_time', { ascending: false });

  if (error) throw error;
  return (data as ClockInWithEmployee[]) || [];
}

/** Lightweight clock-in fetch for report aggregation (no GPS / employee join). */
export async function fetchClockInRecordsInRangeForReport(
  dateFrom: string,
  dateTo: string,
): Promise<ClockInExportRecord[]> {
  const { start, end } = dateRangeToIsoBounds(dateFrom, dateTo);
  const { data, error } = await supabase
    .from('employee_clock_in')
    .select(CLOCK_IN_REPORT_SELECT)
    .gte('clock_in_time', start)
    .lte('clock_in_time', end)
    .order('clock_in_time', { ascending: false });

  if (error) throw error;
  return (data as ClockInExportRecord[]) || [];
}

export function groupClockInTotalsByEmployee(
  records: ClockInExportRecord[],
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

const MS_PER_MINUTE = 60_000;
const MS_PER_HOUR = 60 * MS_PER_MINUTE;

export function formatExportDateDdMm(dateKey: string): string {
  const [, month, day] = dateKey.split('-');
  if (!month || !day) return dateKey;
  return `${day}.${month}`;
}

export function formatExportDateDdMmYyyy(dateKey: string): string {
  const [year, month, day] = dateKey.split('-');
  if (!year || !month || !day) return dateKey;
  return `${day}.${month}.${year}`;
}

export function formatExportDurationHhMm(ms: number): string {
  if (!Number.isFinite(ms) || ms <= 0) return '00:00';
  const totalMinutes = Math.floor(ms / MS_PER_MINUTE);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  const hoursLabel = hours < 10 ? String(hours).padStart(2, '0') : String(hours);
  return `${hoursLabel}:${String(minutes).padStart(2, '0')}`;
}


function sumRecordsDurationMs(
  records: Array<{ clock_in_time: string; clock_out_time: string | null }>,
): number {
  let totalMs = 0;
  const now = Date.now();
  for (const record of records) {
    const start = new Date(record.clock_in_time).getTime();
    const end = record.clock_out_time ? new Date(record.clock_out_time).getTime() : now;
    totalMs += Math.max(0, end - start);
  }
  return totalMs;
}

export function sumCountedClockDurationsMs(records: ClockInExportRecord[]): number {
  return sumRecordsDurationMs(records.filter(isClockInRecordCounted));
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
  totalDurationMs: number;
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
      totalDurationMs: totalMs,
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

function clockSessionColumnHeadersSlim(maxSessions: number): string[] {
  const cols: string[] = [];
  for (let i = 1; i <= maxSessions; i++) {
    cols.push(`Clock in ${i}`, `Clock out ${i}`);
  }
  return cols;
}

function clockSessionColumnValuesSlim(
  sessions: ClockSessionSummary[],
  maxSessions: number,
): Record<string, string> {
  const values: Record<string, string> = {};
  for (let i = 0; i < maxSessions; i++) {
    const n = i + 1;
    const session = sessions[i];
    values[`Clock in ${n}`] = session?.clockIn ?? '';
    values[`Clock out ${n}`] = session?.clockOut ?? '';
  }
  return values;
}

function emptyClockSessionColumnValuesSlim(maxSessions: number): Record<string, string> {
  return clockSessionColumnValuesSlim([], maxSessions);
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

const MERGED_EXPORT_STATIC_COLUMNS = ['Total duration'] as const;

const MERGED_EXPORT_FONT_SIZE = 14;
const MERGED_EXPORT_CELL_STYLE = { font: { sz: MERGED_EXPORT_FONT_SIZE } };
const MERGED_EXPORT_BOLD_CELL_STYLE = { font: { bold: true, sz: MERGED_EXPORT_FONT_SIZE } };

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
  totalDurationMs: number;
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
      totalDurationMs: clock?.totalDurationMs ?? 0,
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
      totalDurationMs: 0,
      totalDuration: '—',
      workplacesIn: '—',
      workplacesOut: '—',
      source: '—',
      notes: '—',
    },
  ];
}

function mergedExportFilename(dateFrom: string, dateTo: string): string {
  const period = `${formatExportDateDdMmYyyy(dateFrom)} - ${formatExportDateDdMmYyyy(dateTo)}`;
  return `Employee Time Sheet_${period}.xlsx`.replace(/[\\/:*?"<>|]/g, '-');
}

export type EmployeeTimeUnavailabilityExportBundle = {
  employeeName: string;
  department: string;
  rows: MergedTimeUnavailabilityExportRow[];
  periodTotalMs: number;
  extraHours125Ms?: number;
  extraHours150Ms?: number;
  deficitHoursMs?: number;
  sickDays?: number;
  vacationDays?: number;
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
    const { exportColumns, rows, dataRowCount, footer } = buildMergedExportSheetRows(sortedRows, maxSessions, {
      periodTotalMs: employee.periodTotalMs,
      extraHours125Ms: employee.extraHours125Ms,
      extraHours150Ms: employee.extraHours150Ms,
      deficitHoursMs: employee.deficitHoursMs,
      sickDays: employee.sickDays,
      vacationDays: employee.vacationDays,
      dateFrom: options.dateFrom,
      dateTo: options.dateTo,
    });

    const ws = createMergedExportWorksheet(exportColumns, rows, dataRowCount, footer);
    const sheetName = sanitizeSheetName(employee.employeeName, usedSheetNames);
    XLSX.utils.book_append_sheet(wb, ws, sheetName);
  }

  const filename = mergedExportFilename(options.dateFrom, options.dateTo);
  XLSX.writeFile(wb, filename);
}

function buildMergedExportSheetRows(
  mergedRows: MergedTimeUnavailabilityExportRow[],
  maxSessions: number,
  options: {
    periodTotalMs?: number;
    extraHours125Ms?: number;
    extraHours150Ms?: number;
    deficitHoursMs?: number;
    sickDays?: number;
    vacationDays?: number;
    dateFrom?: string;
    dateTo?: string;
  },
): {
  exportColumns: string[];
  rows: Record<string, string>[];
  dataRowCount: number;
  footer: {
    hasPeriodTotal: boolean;
    hasExtra125: boolean;
    hasExtra150: boolean;
    hasDeficit: boolean;
    hasSickDays: boolean;
    hasVacationDays: boolean;
  };
} {
  const exportColumns = [
    'Date',
    'Unavailability',
    ...clockSessionColumnHeadersSlim(maxSessions),
    ...MERGED_EXPORT_STATIC_COLUMNS,
  ];

  const rows = mergedRows.map((row) => ({
    Date: row.date === '—' ? '—' : formatExportDateDdMm(row.dateKey),
    Unavailability: row.unavailability === '—' ? '' : row.unavailability,
    ...clockSessionColumnValuesSlim(row.clockSessions, maxSessions),
    'Total duration':
      row.totalDurationMs > 0 ? formatExportDurationHhMm(row.totalDurationMs) : '',
  }));

  const hasPeriodTotal = Boolean(options.dateFrom && options.dateTo);
  const hasExtra125 = options.extraHours125Ms !== undefined;
  const hasExtra150 = options.extraHours150Ms !== undefined;
  const hasDeficit = options.deficitHoursMs !== undefined;
  const hasSickDays = options.sickDays !== undefined;
  const hasVacationDays = options.vacationDays !== undefined;

  if (hasPeriodTotal) {
    const emptyClock = emptyClockSessionColumnValuesSlim(maxSessions);
    rows.push({
      Date: '',
      Unavailability: '',
      ...emptyClock,
      'Total duration': '',
    });
    rows.push({
      Date: `Period total (${formatExportDateDdMmYyyy(options.dateFrom!)} – ${formatExportDateDdMmYyyy(options.dateTo!)})`,
      Unavailability: '',
      ...emptyClock,
      'Total duration': formatExportDurationHhMm(options.periodTotalMs ?? 0),
    });

    if (hasExtra125) {
      rows.push({
        Date: 'Extra hours 125%',
        Unavailability: '',
        ...emptyClock,
        'Total duration': formatExportDurationHhMm(options.extraHours125Ms ?? 0),
      });
    }

    if (hasExtra150) {
      rows.push({
        Date: 'Extra hours 150%',
        Unavailability: '',
        ...emptyClock,
        'Total duration': formatExportDurationHhMm(options.extraHours150Ms ?? 0),
      });
    }

    if (hasDeficit) {
      rows.push({
        Date: '-hours',
        Unavailability: '',
        ...emptyClock,
        'Total duration': formatExportDurationHhMm(options.deficitHoursMs ?? 0),
      });
    }

    if (hasSickDays) {
      rows.push({
        Date: 'Sick days',
        Unavailability: '',
        ...emptyClock,
        'Total duration': String(options.sickDays ?? 0),
      });
    }

    if (hasVacationDays) {
      rows.push({
        Date: 'Vacation',
        Unavailability: '',
        ...emptyClock,
        'Total duration': String(options.vacationDays ?? 0),
      });
    }
  }

  return {
    exportColumns,
    rows,
    dataRowCount: mergedRows.length,
    footer: {
      hasPeriodTotal,
      hasExtra125,
      hasExtra150,
      hasDeficit,
      hasSickDays,
      hasVacationDays,
    },
  };
}

function applyMergedExportColumnWidths(
  exportColumns: string[],
  rows: Record<string, string>[],
): { wch: number }[] {
  const maxWidth = 64;
  return exportColumns.map((column) => {
    let width = column.length;
    for (const row of rows) {
      const cellText = String(row[column] ?? '');
      if (cellText.length > width) width = cellText.length;
    }
    return { wch: Math.min(maxWidth, width + 2) };
  });
}

function applyMergedExportWorksheetStyles(
  ws: XLSX.WorkSheet,
  exportColumns: string[],
  dataRowCount: number,
  rows: Record<string, string>[],
  footer: {
    hasPeriodTotal: boolean;
    hasExtra125: boolean;
    hasExtra150: boolean;
    hasDeficit: boolean;
    hasSickDays: boolean;
    hasVacationDays: boolean;
  },
): void {
  const rangeRef = ws['!ref'];
  if (rangeRef) {
    const range = XLSX.utils.decode_range(rangeRef);
    for (let r = range.s.r; r <= range.e.r; r++) {
      for (let c = range.s.c; c <= range.e.c; c++) {
        const addr = XLSX.utils.encode_cell({ r, c });
        if (ws[addr]) ws[addr].s = { ...MERGED_EXPORT_CELL_STYLE };
      }
    }
  }

  for (let c = 0; c < exportColumns.length; c++) {
    const headerAddr = XLSX.utils.encode_cell({ r: 0, c });
    if (ws[headerAddr]) ws[headerAddr].s = { ...MERGED_EXPORT_BOLD_CELL_STYLE };
  }

  if (!footer.hasPeriodTotal) return;

  const totalDurationCol = exportColumns.indexOf('Total duration');
  const boldCell = (row: number, col: number) => {
    const addr = XLSX.utils.encode_cell({ r: row, c: col });
    if (ws[addr]) ws[addr].s = { ...MERGED_EXPORT_BOLD_CELL_STYLE };
  };

  // Header row + data rows + blank separator row → period total starts here
  let summaryRow = dataRowCount + 2;
  boldCell(summaryRow, 0);
  if (totalDurationCol >= 0) boldCell(summaryRow, totalDurationCol);
  summaryRow += 1;

  if (footer.hasExtra125) {
    boldCell(summaryRow, 0);
    if (totalDurationCol >= 0) boldCell(summaryRow, totalDurationCol);
    summaryRow += 1;
  }

  if (footer.hasExtra150) {
    boldCell(summaryRow, 0);
    if (totalDurationCol >= 0) boldCell(summaryRow, totalDurationCol);
    summaryRow += 1;
  }

  if (footer.hasDeficit) {
    boldCell(summaryRow, 0);
    if (totalDurationCol >= 0) boldCell(summaryRow, totalDurationCol);
    summaryRow += 1;
  }

  if (footer.hasSickDays) {
    boldCell(summaryRow, 0);
    if (totalDurationCol >= 0) boldCell(summaryRow, totalDurationCol);
    summaryRow += 1;
  }

  if (footer.hasVacationDays) {
    boldCell(summaryRow, 0);
    if (totalDurationCol >= 0) boldCell(summaryRow, totalDurationCol);
  }

  ws['!cols'] = applyMergedExportColumnWidths(exportColumns, rows);
}

function createMergedExportWorksheet(
  exportColumns: string[],
  rows: Record<string, string>[],
  dataRowCount: number,
  footer: {
    hasPeriodTotal: boolean;
    hasExtra125: boolean;
    hasExtra150: boolean;
    hasDeficit: boolean;
    hasSickDays: boolean;
    hasVacationDays: boolean;
  },
): XLSX.WorkSheet {
  const ws = XLSX.utils.json_to_sheet(rows, { header: exportColumns });
  applyMergedExportWorksheetStyles(ws, exportColumns, dataRowCount, rows, footer);
  return ws;
}

export function exportMergedTimeAndUnavailabilitiesToExcel(
  mergedRows: MergedTimeUnavailabilityExportRow[],
  options: {
    employeeName: string;
    department?: string;
    dateFrom: string;
    dateTo: string;
    periodTotalMs: number;
    extraHours125Ms?: number;
    extraHours150Ms?: number;
    deficitHoursMs?: number;
    sickDays?: number;
    vacationDays?: number;
    filenameSuffix?: string;
  },
): void {
  const maxSessions = Math.max(1, maxClockSessionsCount(mergedRows.map((row) => row.clockSessions)));
  const { exportColumns, rows, dataRowCount, footer } = buildMergedExportSheetRows(mergedRows, maxSessions, {
    periodTotalMs: options.periodTotalMs,
    extraHours125Ms: options.extraHours125Ms,
    extraHours150Ms: options.extraHours150Ms,
    deficitHoursMs: options.deficitHoursMs,
    sickDays: options.sickDays,
    vacationDays: options.vacationDays,
    dateFrom: options.dateFrom,
    dateTo: options.dateTo,
  });

  const ws = createMergedExportWorksheet(exportColumns, rows, dataRowCount, footer);
  const wb = XLSX.utils.book_new();
  const usedSheetNames = new Set<string>();
  const sheetName = sanitizeSheetName(options.employeeName.trim() || 'Employee', usedSheetNames);
  XLSX.utils.book_append_sheet(wb, ws, sheetName);
  XLSX.writeFile(wb, mergedExportFilename(options.dateFrom, options.dateTo));
}
