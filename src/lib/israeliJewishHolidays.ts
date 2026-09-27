import { eachDayInRange, monthRange, toDateInputValue } from './employeeClockInFormat';

export type HolidayDateWarning = {
  date: string;
  holidays: string[];
};

export type HebcalItem = {
  title?: string;
  date?: string;
  category?: string;
  subcat?: string;
  /** Hebcal sets this only on the days when work is prohibited. */
  yomtov?: boolean;
};

export type YearHolidays = {
  /** Every relevant title by ISO date — labels, warnings, calendar cells. */
  all: Map<string, string[]>;
  /** Statutory days off only — drives 150% pay and the working-day base. */
  premium: Map<string, string[]>;
};

const RELEVANT_CATEGORIES = new Set([
  'holiday',
  'yomtov',
  'fast',
  'roshchodesh',
  'modern',
]);

const yearCache = new Map<number, YearHolidays>();
const loadingYears = new Map<number, Promise<YearHolidays>>();

function emptyYearHolidays(): YearHolidays {
  return { all: new Map(), premium: new Map() };
}

function isRelevantHebcalItem(item: HebcalItem): boolean {
  if (!item.date || !item.title) return false;
  const category = (item.category || '').toLowerCase();
  if (!RELEVANT_CATEGORIES.has(category)) return false;
  const title = item.title.toLowerCase();
  if (title.includes('parashat')) return false;
  if (title.includes('candle')) return false;
  return true;
}

/** Hebcal transliterates with a curly apostrophe: "Yom HaAtzma’ut". */
function foldApostrophes(value: string): string {
  return value.replace(/[’‘'`]/g, '');
}

/**
 * Israeli statutory days off — paid, and worked hours on them earn 150%.
 *
 * Hebcal flags the eight yomtov days directly. Yom HaAtzmaut is a national holiday
 * rather than a yomtov, so it is the one entry that has to be named.
 *
 * Deliberately not matched on titles: a substring test for "rosh hashana" also
 * accepts the minor holiday "Rosh Hashana LaBehemot" (1 Elul), an ordinary working
 * day, which then removed the day before it from everyone's working-day base.
 */
function isIsraeliStatutoryDayOff(item: HebcalItem): boolean {
  if (item.yomtov === true) return true;
  const title = foldApostrophes((item.title || '').toLowerCase());
  return title.includes('yom haatzmaut') || title.includes('independence day');
}

async function fetchYearHolidays(year: number): Promise<YearHolidays> {
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
  return buildYearHolidaysFromItems(data.items || []);
}

/** Split raw Hebcal items into all titles and statutory days off. */
export function buildYearHolidaysFromItems(items: HebcalItem[]): YearHolidays {
  const holidays = emptyYearHolidays();

  const add = (map: Map<string, string[]>, iso: string, title: string) => {
    const bucket = map.get(iso);
    if (bucket) {
      if (!bucket.includes(title)) bucket.push(title);
    } else {
      map.set(iso, [title]);
    }
  };

  for (const item of items) {
    if (!isRelevantHebcalItem(item)) continue;
    const iso = item.date!;
    const title = item.title!.trim();
    add(holidays.all, iso, title);
    if (isIsraeliStatutoryDayOff(item)) add(holidays.premium, iso, title);
  }

  return holidays;
}

async function ensureYearLoaded(year: number): Promise<YearHolidays> {
  const cached = yearCache.get(year);
  if (cached) return cached;

  const pending = loadingYears.get(year);
  if (pending) return pending;

  const promise = fetchYearHolidays(year)
    .then((holidays) => {
      yearCache.set(year, holidays);
      loadingYears.delete(year);
      return holidays;
    })
    .catch((err) => {
      loadingYears.delete(year);
      console.error(`Israeli holidays fetch failed for ${year}:`, err);
      const empty = emptyYearHolidays();
      yearCache.set(year, empty);
      return empty;
    });

  loadingYears.set(year, promise);
  return promise;
}

export async function preloadHolidayYears(years: number[]): Promise<void> {
  await Promise.all(years.map((year) => ensureYearLoaded(year)));
}

/** Every holiday title in the year — for display, warnings and calendar cells. */
export function getHolidaysForYearMap(year: number): Map<string, string[]> {
  return yearCache.get(year)?.all ?? new Map();
}

/** Statutory days off only — for 150% pay and the working-day base. */
export function getPremiumHolidaysForYearMap(year: number): Map<string, string[]> {
  return yearCache.get(year)?.premium ?? new Map();
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
  const holidays = await ensureYearLoaded(year);
  return [...(holidays.all.get(isoDate) ?? [])];
}

export async function getHolidayWarningsForDates(
  dates: string[],
): Promise<HolidayDateWarning[]> {
  const unique = [...new Set(dates.filter(Boolean))].sort();
  const years = [...new Set(unique.map((date) => Number(date.slice(0, 4))).filter(Number.isFinite))];
  await Promise.all(years.map((year) => ensureYearLoaded(year)));

  const warnings: HolidayDateWarning[] = [];
  for (const date of unique) {
    const holidays = [...(yearCache.get(Number(date.slice(0, 4)))?.all.get(date) ?? [])];
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
