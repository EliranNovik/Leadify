import { supabase } from './supabase';

export const OFFICIAL_HOLIDAY_NAME = 'Official holiday';

const officialHolidays = new Map<string, string>();
let loaded = false;
let loading: Promise<void> | null = null;

export function officialHolidayNames(dateKey: string): string[] {
  const name = officialHolidays.get(dateKey);
  return name ? [name] : [];
}

export function getOfficialHolidayDates(): Set<string> {
  return new Set(officialHolidays.keys());
}

/** Replace the in-memory list. Tests use this; the app uses the loader below. */
export function replaceOfficialHolidays(entries: Iterable<[string, string]>): void {
  officialHolidays.clear();
  for (const [date, name] of entries) {
    const key = date.slice(0, 10);
    if (key) officialHolidays.set(key, name || OFFICIAL_HOLIDAY_NAME);
  }
}

export async function preloadOfficialHolidays(force = false): Promise<void> {
  if (loaded && !force) return;
  if (loading && !force) return loading;

  const promise = (async () => {
    const { data, error } = await supabase
      .from('company_official_holidays')
      .select('work_date, name');

    if (error) {
      console.warn('[official holidays]', error.message);
      return;
    }

    replaceOfficialHolidays(
      (data || []).map((row) => [
        String(row.work_date || ''),
        String(row.name || OFFICIAL_HOLIDAY_NAME),
      ]),
    );
    loaded = true;
  })();

  loading = promise;
  try {
    await promise;
  } finally {
    if (loading === promise) loading = null;
  }
}

export async function markCompanyOfficialHoliday(
  workDate: string,
  name = OFFICIAL_HOLIDAY_NAME,
): Promise<void> {
  const { error } = await supabase
    .from('company_official_holidays')
    .upsert({ work_date: workDate, name }, { onConflict: 'work_date' });

  if (error) throw new Error(error.message);
  officialHolidays.set(workDate, name);
  loaded = true;
}

export async function removeCompanyOfficialHoliday(workDate: string): Promise<void> {
  const { error } = await supabase
    .from('company_official_holidays')
    .delete()
    .eq('work_date', workDate);

  if (error) throw new Error(error.message);
  officialHolidays.delete(workDate);
  loaded = true;
}
