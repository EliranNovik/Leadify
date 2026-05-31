import { supabase } from './supabase';
import { getJerusalemDateFromTimestamp, getJerusalemTodayIsoDate } from './boiCurrencyConversion';

export type Stage60Record = {
  id: number;
  lead_id?: number | null;
  newlead_id?: string | null;
  stage?: number;
  cdate?: string | null;
  date?: string | null;
};

export const STAGE60_SELECT = 'id, lead_id, newlead_id, stage, cdate, date';

export const toStartOfDayIso = (dateStr: string) => `${dateStr}T00:00:00.000Z`;

export const toEndOfDayIso = (dateStr: string) => `${dateStr}T23:59:59.999Z`;

export const computeDateBounds = (fromDate?: string, toDate?: string) => {
  const startIso = fromDate ? toStartOfDayIso(fromDate) : null;
  const endIso = (() => {
    if (toDate) return toEndOfDayIso(toDate);
    if (fromDate) return toEndOfDayIso(fromDate);
    return null;
  })();
  return { startIso, endIso };
};

export const addCalendarDays = (isoDate: string, delta: number): string => {
  const [y, m, day] = isoDate.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, day + delta));
  const yy = dt.getUTCFullYear();
  const mm = String(dt.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(dt.getUTCDate()).padStart(2, '0');
  return `${yy}-${mm}-${dd}`;
};

/** YYYY-MM-DD in Asia/Jerusalem for a DB timestamp (matches SignedSalesReport local-calendar intent). */
export const toSignCalendarDateKey = (value: string | null | undefined): string | null => {
  if (!value) return null;
  return getJerusalemDateFromTimestamp(value);
};

export const stageRecordMatchesSignDateRange = (
  record: { date?: string | null; cdate?: string | null },
  fromDate?: string,
  toDate?: string,
): boolean => {
  if (!fromDate && !toDate) return true;
  const raw = record.date ?? record.cdate;
  if (!raw) return false;
  const key = toSignCalendarDateKey(raw);
  if (!key) return false;
  const from = fromDate || toDate;
  const to = toDate || fromDate;
  if (from && key < from) return false;
  if (to && key > to) return false;
  return true;
};

/** Resolve sign timestamp (prefer `date`, fallback `cdate`). */
export const resolveStage60SignTimestamp = (record: { date?: string | null; cdate?: string | null }): string | null =>
  record.date ?? record.cdate ?? null;

/**
 * Fetch stage-60 rows for a calendar range (Jerusalem day keys).
 * Widens SQL by ±1 day then filters strictly — same logic as SignedSalesReportPage.
 */
export async function fetchStage60RecordsInRange(
  fromDate?: string,
  toDate?: string,
): Promise<Stage60Record[]> {
  const { startIso, endIso } = computeDateBounds(fromDate, toDate);
  const anyCalendarFilter = Boolean(fromDate || toDate);
  const rangeDayLo = fromDate || toDate;
  const rangeDayHi = toDate || fromDate;

  const wideStartIso =
    anyCalendarFilter && rangeDayLo ? toStartOfDayIso(addCalendarDays(rangeDayLo, -1)) : startIso;
  const wideEndIso =
    anyCalendarFilter && rangeDayHi ? toEndOfDayIso(addCalendarDays(rangeDayHi, 1)) : endIso;

  if (anyCalendarFilter && wideStartIso && wideEndIso) {
    const qDate = supabase
      .from('leads_leadstage')
      .select(STAGE60_SELECT)
      .eq('stage', 60)
      .gte('date', wideStartIso)
      .lte('date', wideEndIso);

    const qCdateWhenDateNull = supabase
      .from('leads_leadstage')
      .select(STAGE60_SELECT)
      .eq('stage', 60)
      .is('date', null)
      .gte('cdate', wideStartIso)
      .lte('cdate', wideEndIso);

    const [resDate, resCdate] = await Promise.all([qDate, qCdateWhenDateNull]);

    if (resDate.error) throw resDate.error;
    if (resCdate.error) throw resCdate.error;

    const byId = new Map<number, Stage60Record>();
    for (const row of [...(resDate.data || []), ...(resCdate.data || [])]) {
      const id = Number(row.id);
      if (Number.isFinite(id)) byId.set(id, row as Stage60Record);
    }

    return Array.from(byId.values()).filter((row) =>
      stageRecordMatchesSignDateRange(row, fromDate, toDate),
    );
  }

  let query = supabase.from('leads_leadstage').select(STAGE60_SELECT).eq('stage', 60);
  if (startIso) query = query.gte('date', startIso);
  if (endIso) query = query.lte('date', endIso);
  const { data, error } = await query;
  if (error) throw error;
  return (data || []) as Stage60Record[];
}

export function getJerusalemScoreboardDates(reference = new Date()) {
  const todayStr = getJerusalemTodayIsoDate(reference);
  return {
    todayStr,
    yesterdayStr: addCalendarDays(todayStr, -1),
    oneWeekAgoStr: addCalendarDays(todayStr, -7),
    thirtyDaysAgoStr: addCalendarDays(todayStr, -30),
  };
}
