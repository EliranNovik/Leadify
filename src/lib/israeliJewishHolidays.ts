import { eachDayInRange, monthRange, toDateInputValue } from './employeeClockInFormat';

export type HolidayDateWarning = {
  date: string;
  holidays: string[];
};

type HebcalItem = {
  title?: string;
  date?: string;
  category?: string;
};

const RELEVANT_CATEGORIES = new Set([
  'holiday',
  'yomtov',
  'fast',
  'roshchodesh',
  'modern',
]);

const yearCache = new Map<number, Map<string, string[]>>();
const loadingYears = new Map<number, Promise<Map<string, string[]>>>();

function isRelevantHebcalItem(item: HebcalItem): boolean {
  if (!item.date || !item.title) return false;
  const category = (item.category || '').toLowerCase();
  if (!RELEVANT_CATEGORIES.has(category)) return false;
  const title = item.title.toLowerCase();
  if (title.includes('parashat')) return false;
  if (title.includes('candle')) return false;
  return true;
}

async function fetchYearHolidayMap(year: number): Promise<Map<string, string[]>> {
  const url = new URL('https://www.hebcal.com/hebcal/');
  url.searchParams.set('v', '1');
  url.searchParams.set('cfg', 'json');
  url.searchParams.set('year', String(year));
  url.searchParams.set('i', 'on');
  url.searchParams.set('maj', 'on');
  url.searchParams.set('min', 'on');
  url.searchParams.set('mod', 'on');
  url.searchParams.set('nx', 'on');
  url.searchParams.set('mf', 'on');
  url.searchParams.set('ss', 'on');

  const response = await fetch(url.toString());
  if (!response.ok) {
    throw new Error(`Hebcal API failed (${response.status})`);
  }

  const data = (await response.json()) as { items?: HebcalItem[] };
  const map = new Map<string, string[]>();

  for (const item of data.items || []) {
    if (!isRelevantHebcalItem(item)) continue;
    const iso = item.date!;
    const title = item.title!.trim();
    const bucket = map.get(iso);
    if (bucket) {
      if (!bucket.includes(title)) bucket.push(title);
    } else {
      map.set(iso, [title]);
    }
  }

  return map;
}

async function ensureYearLoaded(year: number): Promise<Map<string, string[]>> {
  const cached = yearCache.get(year);
  if (cached) return cached;

  const pending = loadingYears.get(year);
  if (pending) return pending;

  const promise = fetchYearHolidayMap(year)
    .then((map) => {
      yearCache.set(year, map);
      loadingYears.delete(year);
      return map;
    })
    .catch((err) => {
      loadingYears.delete(year);
      console.error(`Israeli holidays fetch failed for ${year}:`, err);
      const empty = new Map<string, string[]>();
      yearCache.set(year, empty);
      return empty;
    });

  loadingYears.set(year, promise);
  return promise;
}

export async function preloadHolidayYears(years: number[]): Promise<void> {
  await Promise.all(years.map((year) => ensureYearLoaded(year)));
}

export function getHolidaysForYearMap(year: number): Map<string, string[]> {
  return yearCache.get(year) ?? new Map();
}

/** Holiday dates in a calendar month (from cache; preload year first). */
export function getHolidayDatesInMonth(year: number, month: number): Set<string> {
  const map = getHolidaysForYearMap(year);
  const { from, to } = monthRange(year, month);
  const dates = new Set<string>();
  for (const day of eachDayInRange(from, to)) {
    if (map.has(day)) dates.add(day);
  }
  return dates;
}

export async function getHolidayNamesForDate(isoDate: string): Promise<string[]> {
  const year = Number(isoDate.slice(0, 4));
  if (!Number.isFinite(year)) return [];
  const map = await ensureYearLoaded(year);
  return [...(map.get(isoDate) ?? [])];
}

export async function getHolidayWarningsForDates(
  dates: string[],
): Promise<HolidayDateWarning[]> {
  const unique = [...new Set(dates.filter(Boolean))].sort();
  const years = [...new Set(unique.map((date) => Number(date.slice(0, 4))).filter(Number.isFinite))];
  await Promise.all(years.map((year) => ensureYearLoaded(year)));

  const warnings: HolidayDateWarning[] = [];
  for (const date of unique) {
    const holidays = [...(yearCache.get(Number(date.slice(0, 4)))?.get(date) ?? [])];
    if (holidays.length > 0) {
      warnings.push({ date, holidays });
    }
  }
  return warnings;
}

export async function getHolidayWarningsForRange(
  from: string,
  to: string,
): Promise<HolidayDateWarning[]> {
  return getHolidayWarningsForDates(eachDayInRange(from, to));
}

/** Short label for compact calendar day cells. */
export function holidayCompactLabel(name: string): string {
  const trimmed = name.trim();
  if (trimmed.length <= 10) return trimmed;
  const firstWord = trimmed.split(/\s+/)[0];
  if (firstWord.length >= 4 && firstWord.length <= 12) return firstWord;
  return `${trimmed.slice(0, 9)}…`;
}
