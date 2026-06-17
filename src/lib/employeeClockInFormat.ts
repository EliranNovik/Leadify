export function formatClockTime(iso: string | null | undefined): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleTimeString('en-GB', {
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function formatClockDate(iso: string | null | undefined): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('en-GB', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  });
}

/** Parse YYYY-MM-DD as a local calendar date (no timezone shift). */
export function parseDateKeyLocal(dateKey: string): Date {
  const [y, m, d] = dateKey.split('-').map(Number);
  return new Date(y, m - 1, d);
}

const WEEKDAY_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] as const;

/** Three-letter weekday for a YYYY-MM-DD key (e.g. "Mon"). */
export function formatWorkingHoursWeekday(dateKey: string): string {
  const [y, m, d] = dateKey.split('-').map(Number);
  return WEEKDAY_SHORT[new Date(y, m - 1, d).getDay()];
}

/** Calendar date for working hours UI (e.g. "02 June"). */
export function formatWorkingHoursDateLabel(dateKey: string): string {
  return parseDateKeyLocal(dateKey).toLocaleDateString('en-GB', {
    day: '2-digit',
    month: 'long',
  });
}

/** Long weekday for a YYYY-MM-DD key (e.g. "Monday"). */
export function formatWorkingHoursWeekdayLong(dateKey: string): string {
  return parseDateKeyLocal(dateKey).toLocaleDateString('en-GB', { weekday: 'long' });
}

export function formatClockDuration(start: string, end: string | null): string {
  if (!end) return 'In progress…';
  const diffMs = new Date(end).getTime() - new Date(start).getTime();
  if (diffMs <= 0) return '0m';
  const hours = Math.floor(diffMs / (1000 * 60 * 60));
  const minutes = Math.floor((diffMs % (1000 * 60 * 60)) / (1000 * 60));
  return hours > 0 ? `${hours}h ${minutes}m` : `${minutes}m`;
}

export function sumClockDurations(
  records: Array<{ clock_in_time: string; clock_out_time: string | null }>,
): string {
  let totalMs = 0;
  const now = Date.now();
  for (const r of records) {
    const start = new Date(r.clock_in_time).getTime();
    const end = r.clock_out_time ? new Date(r.clock_out_time).getTime() : now;
    totalMs += Math.max(0, end - start);
  }
  const hours = Math.floor(totalMs / (1000 * 60 * 60));
  const minutes = Math.floor((totalMs % (1000 * 60 * 60)) / (1000 * 60));
  return `${hours}h ${minutes}m`;
}

export function toDateInputValue(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export function monthRange(year: number, month1to12: number): { from: string; to: string } {
  const from = new Date(year, month1to12 - 1, 1);
  const to = new Date(year, month1to12, 0);
  return { from: toDateInputValue(from), to: toDateInputValue(to) };
}

export function eachDayInRange(from: string, to: string): string[] {
  const days: string[] = [];
  const [y0, m0, d0] = from.split('-').map(Number);
  const end = new Date(`${to}T12:00:00`);
  const cur = new Date(y0, m0 - 1, d0);
  while (cur <= end) {
    days.push(toDateInputValue(cur));
    cur.setDate(cur.getDate() + 1);
  }
  return days;
}

/** Sunday (start of week) for a YYYY-MM-DD key. */
export function getSundayWeekStartKey(dateKey: string): string {
  const date = parseDateKeyLocal(dateKey);
  const sunday = new Date(date);
  sunday.setDate(date.getDate() - date.getDay());
  return toDateInputValue(sunday);
}

/** Maps each Sunday week-start in a month to 1-based week number (Week 1, Week 2, …). */
export function buildMonthWeekNumberLookup(year: number, month: number): Map<string, number> {
  const { from, to } = monthRange(year, month);
  const lookup = new Map<string, number>();
  let weekNum = 0;
  let prevWeekStart = '';
  for (const day of eachDayInRange(from, to)) {
    const weekStart = getSundayWeekStartKey(day);
    if (weekStart !== prevWeekStart) {
      weekNum += 1;
      prevWeekStart = weekStart;
      lookup.set(weekStart, weekNum);
    }
  }
  return lookup;
}

/** Israeli work week: Sunday–Thursday (Fri/Sat excluded). */
export function isIsraeliWorkdayIso(iso: string): boolean {
  const [y, m, d] = iso.split('-').map(Number);
  const dow = new Date(y, m - 1, d).getDay();
  return dow >= 0 && dow <= 4;
}

/** Workdays in month (Sun–Thu, up to today) missing clock-in or unavailability. */
export function countMissingMonthEntryDays(
  year: number,
  month: number,
  coveredDayKeys: Iterable<string>,
  asOfDate = toDateInputValue(new Date()),
  excludeDates: Iterable<string> = [],
): number {
  const covered = new Set(coveredDayKeys);
  const excluded = new Set(excludeDates);
  const { from, to } = monthRange(year, month);
  let missing = 0;
  for (const day of eachDayInRange(from, to)) {
    if (day > asOfDate) continue;
    if (!isIsraeliWorkdayIso(day)) continue;
    if (excluded.has(day)) continue;
    if (!covered.has(day)) missing++;
  }
  return missing;
}

export function dateRangeToIsoBounds(from: string, to: string): { start: string; end: string } {
  const start = new Date(`${from}T00:00:00`);
  const end = new Date(`${to}T23:59:59.999`);
  return { start: start.toISOString(), end: end.toISOString() };
}
