import { getJerusalemDateFromTimestamp } from './boiCurrencyConversion';

const JERUSALEM_TZ = 'Asia/Jerusalem';

function jerusalemDateKey(d: Date): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: JERUSALEM_TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(d);
}

function jerusalemTimeParts(d: Date) {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: JERUSALEM_TZ,
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).formatToParts(d);
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value ?? 0);
  return { hour: get('hour'), minute: get('minute'), second: get('second') };
}

/** UTC ISO for 00:00:00.000 on a calendar day in Asia/Jerusalem. */
export function buildJerusalemStartOfDayIso(dateStr: string): string {
  for (const offset of ['+03:00', '+02:00']) {
    const candidate = `${dateStr}T00:00:00.000${offset}`;
    const d = new Date(candidate);
    const { hour, minute, second } = jerusalemTimeParts(d);
    if (jerusalemDateKey(d) === dateStr && hour === 0 && minute === 0 && second === 0) {
      return d.toISOString();
    }
  }
  return new Date(`${dateStr}T00:00:00+03:00`).toISOString();
}

/** UTC ISO for 23:59:59.999 on a calendar day in Asia/Jerusalem. */
export function buildJerusalemEndOfDayIso(dateStr: string): string {
  for (const offset of ['+03:00', '+02:00']) {
    const candidate = `${dateStr}T23:59:59.999${offset}`;
    const d = new Date(candidate);
    const { hour, minute, second } = jerusalemTimeParts(d);
    if (jerusalemDateKey(d) === dateStr && hour === 23 && minute === 59 && second === 59) {
      return d.toISOString();
    }
  }
  return new Date(`${dateStr}T23:59:59.999+03:00`).toISOString();
}

/** Match Lead Search / SignedSalesReport: calendar day in Asia/Jerusalem. */
export function timestampInCalendarRange(
  timestamp: string | null | undefined,
  fromDate: string,
  toDate: string,
): boolean {
  if (!fromDate && !toDate) return true;
  if (!timestamp) return false;
  const key = getJerusalemDateFromTimestamp(timestamp);
  const from = fromDate || toDate;
  const to = toDate || fromDate;
  if (from && key < from) return false;
  if (to && key > to) return false;
  return true;
}

export type SourceRowLike = { id: string | number; name: string };

export function resolveSourceFilterNames(
  selectedSourceIds: string[],
  allSources: SourceRowLike[],
): string[] {
  const ids = new Set(selectedSourceIds.map(String));
  const names = new Set<string>();
  for (const s of allSources) {
    if (ids.has(String(s.id))) {
      const n = String(s.name || '').trim();
      if (n) names.add(n);
    }
  }
  return [...names];
}

/** All misc_leadsource ids sharing the selected source name(s) — matches Lead Search `.in('name', ...)`. */
export function resolveAllSourceIdsForNames(
  names: string[],
  allSources: SourceRowLike[],
): number[] {
  const nameKeys = new Set(names.map((n) => n.trim().toLowerCase()));
  const ids: number[] = [];
  for (const s of allSources) {
    if (nameKeys.has(String(s.name || '').trim().toLowerCase())) {
      const n = Number(s.id);
      if (Number.isFinite(n)) ids.push(n);
    }
  }
  return ids;
}

/** Numeric misc_leadsource ids from explicit selection (firm/channel/source filters). */
export function parseNumericSourceIds(sourceIds: string[]): number[] {
  return sourceIds.map((id) => Number(id)).filter((n) => Number.isFinite(n));
}

/** Union of explicitly selected ids + all ids sharing those sources' names. */
export function resolveUnionSourceIdsForFilter(
  selectedSourceIds: string[],
  allSources: SourceRowLike[],
): number[] {
  const direct = parseNumericSourceIds(selectedSourceIds);
  const names = resolveSourceFilterNames(selectedSourceIds, allSources);
  const fromNames = resolveAllSourceIdsForNames(names, allSources);
  return [...new Set([...direct, ...fromNames])];
}

/** PostgREST `.or(...)` clause from source names (Lead Search) or resolved from selected ids (Marketing). */
export function buildLeadSourceOrFilterClauseFromNames(
  selectedSourceNames: string[],
  allSources: SourceRowLike[],
): string | null {
  const names = [...new Set(selectedSourceNames.map((n) => n.trim()).filter(Boolean))];
  if (names.length === 0) return null;
  const sourceIds = resolveAllSourceIdsForNames(names, allSources);
  const orParts: string[] = [];
  if (sourceIds.length === 1) {
    orParts.push(`source_id.eq.${sourceIds[0]}`);
  } else if (sourceIds.length > 1) {
    orParts.push(`source_id.in.(${sourceIds.join(',')})`);
  }
  for (const name of names) {
    orParts.push(`source.eq.${encodeURIComponent(name)}`);
  }
  return orParts.length > 0 ? orParts.join(',') : null;
}

/** PostgREST filter for `leads_lead` — source_id only (`leads_lead` has no `source` text column). */
export function buildLegacyLeadSourceIdOrFilterClauseFromNames(
  selectedSourceNames: string[],
  allSources: SourceRowLike[],
): string | null {
  const names = [...new Set(selectedSourceNames.map((n) => n.trim()).filter(Boolean))];
  if (names.length === 0) return null;
  const sourceIds = resolveAllSourceIdsForNames(names, allSources);
  if (sourceIds.length === 1) return `source_id.eq.${sourceIds[0]}`;
  if (sourceIds.length > 1) return `source_id.in.(${sourceIds.join(',')})`;
  return null;
}

/** PostgREST filter for `leads_lead` from selected source ids — uses ids directly, then name expansion. */
export function buildLegacyLeadSourceIdOrFilterClause(
  selectedSourceIds: string[],
  allSources: SourceRowLike[],
): string | null {
  const ids = resolveUnionSourceIdsForFilter(selectedSourceIds, allSources);
  if (ids.length === 1) return `source_id.eq.${ids[0]}`;
  if (ids.length > 1) return `source_id.in.(${ids.join(',')})`;
  return null;
}

/** PostgREST `.or(...)` clause: source_id match OR `source` text on `leads`. */
export function buildLeadSourceOrFilterClause(
  selectedSourceIds: string[],
  allSources: SourceRowLike[],
): string | null {
  const ids = resolveUnionSourceIdsForFilter(selectedSourceIds, allSources);
  const names = resolveSourceFilterNames(selectedSourceIds, allSources);
  const orParts: string[] = [];
  if (ids.length === 1) {
    orParts.push(`source_id.eq.${ids[0]}`);
  } else if (ids.length > 1) {
    orParts.push(`source_id.in.(${ids.join(',')})`);
  }
  for (const name of names) {
    orParts.push(`source.eq.${encodeURIComponent(name)}`);
  }
  return orParts.length > 0 ? orParts.join(',') : null;
}

export function isFirmOnlyReportScope(
  sourceIds: string[],
  channelIds: string[],
  firmIds: string[],
): boolean {
  return firmIds.length > 0 && channelIds.length === 0 && sourceIds.length === 0;
}

export type SourceRowWithChannel = SourceRowLike & { channel_id?: string | null };

/**
 * Source ids to use in SQL when channel / firm / source filters are combined (AND).
 * `null` = no source-scoping filters — fetch all sources in the date range.
 * `[]` = filters active but nothing matches — skip fetch.
 */
export function resolveEffectiveSourceIdsForFetch(
  sourceIds: string[],
  channelIds: string[],
  firmIds: string[],
  allSources: SourceRowWithChannel[],
  firmIdToSourceIds: Map<string, string[]>,
): string[] | null {
  const hasChannel = channelIds.length > 0;
  const hasFirm = firmIds.length > 0;
  const hasSource = sourceIds.length > 0;
  if (!hasChannel && !hasFirm && !hasSource) return null;

  let pool: Set<string> | null = null;
  const intersect = (ids: string[]) => {
    const next = new Set(ids.map(String).filter(Boolean));
    if (pool === null) pool = next;
    else pool = new Set([...pool].filter((id) => next.has(id)));
  };

  if (hasChannel) {
    intersect(
      allSources
        .filter((s) => s.channel_id && channelIds.includes(String(s.channel_id)))
        .map((s) => String(s.id)),
    );
  }
  if (hasFirm) {
    const firmSources = new Set<string>();
    for (const firmId of firmIds) {
      for (const sid of firmIdToSourceIds.get(firmId) || []) {
        firmSources.add(String(sid));
      }
    }
    intersect([...firmSources]);
  }
  if (hasSource) {
    intersect(sourceIds.map(String));
  }

  return pool ? [...pool] : [];
}
