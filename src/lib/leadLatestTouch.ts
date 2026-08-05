import { supabase } from './supabase';
import { parseDateMs } from './pipelineSummary';

/**
 * Latest interaction per lead across WhatsApp, email and calls.
 *
 * The denormalised `latest_interaction` columns on the lead tables are unreliable, so both
 * pipelines derive the Last interaction date — and the "client wrote, we never replied" flag —
 * straight from the interaction tables, which is also what the interactions modal reads.
 *
 * Row ids follow the pipeline convention: a new lead uses its uuid, a legacy lead `legacy_<id>`.
 */

export function chunkIds<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

export function normalizeInteractionDirection(raw: string | null | undefined): 'in' | 'out' | null {
  const d = (raw || '').toLowerCase();
  if (d === 'inbound' || d === 'in' || d === 'incoming') return 'in';
  if (d === 'outbound' || d === 'out' || d === 'outgoing') return 'out';
  return null;
}

/**
 * Latest interaction plus the newest directional timestamps across every channel.
 * Directional timestamps are tracked separately because an undirected interaction must not
 * hide an older inbound message that still has no later outbound reply.
 */
export type LatestTouch = {
  at: number;
  direction: 'in' | 'out' | null;
  latestInboundAt: number | null;
  latestOutboundAt: number | null;
};

export function considerLatestTouch(
  map: Map<string, LatestTouch>,
  rowId: string,
  atRaw: string | null | undefined,
  directionRaw: string | null | undefined,
) {
  const at = Date.parse(String(atRaw || ''));
  if (!Number.isFinite(at)) return;
  const direction = normalizeInteractionDirection(directionRaw);
  const prev = map.get(rowId);
  const latestInboundAt =
    direction === 'in' ? Math.max(prev?.latestInboundAt ?? -Infinity, at) : prev?.latestInboundAt ?? null;
  const latestOutboundAt =
    direction === 'out'
      ? Math.max(prev?.latestOutboundAt ?? -Infinity, at)
      : prev?.latestOutboundAt ?? null;

  if (!prev || at > prev.at) {
    map.set(rowId, { at, direction, latestInboundAt, latestOutboundAt });
    return;
  }

  // Keep directional history even when this is not the newest interaction overall.
  if (
    latestInboundAt !== prev.latestInboundAt ||
    latestOutboundAt !== prev.latestOutboundAt
  ) {
    map.set(rowId, { ...prev, latestInboundAt, latestOutboundAt });
  }
}

export function isAwaitingReply(touch: LatestTouch | null | undefined): boolean {
  if (!touch || touch.latestInboundAt == null) return false;
  return touch.latestOutboundAt == null || touch.latestOutboundAt <= touch.latestInboundAt;
}

export function callLogTimestamp(cdate?: string | null, time?: string | null): string | null {
  const date = (cdate || '').trim();
  if (!date) return null;
  // cdate is a full timestamptz on newer rows and a bare date on older ones; only the
  // bare form needs the separate time column appended.
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return date;
  const t = (time || '00:00:00').trim().substring(0, 8) || '00:00:00';
  return `${date}T${t}`;
}


export type TouchSource = {
  table: string;
  idColumn: string;
  select: string;
  orderColumn: string;
  /** Row id in the pipeline (`legacy_` prefixed for legacy leads). */
  toRowId: (row: any) => string | null;
  toTimestamp: (row: any) => string | null;
};

/**
 * Interaction history for one lead. Normally all rows fit in one indexed lookup. Extremely
 * active leads get three targeted lookups so their latest overall, inbound, and outbound
 * timestamps are still exact.
 */
async function collectLatestTouchForId(
  id: string,
  source: TouchSource,
  latest: Map<string, LatestTouch>,
): Promise<void> {
  const SINGLE_LEAD_LIMIT = 5000;
  const { data, error } = await supabase
    .from(source.table)
    .select(source.select)
    .eq(source.idColumn, id)
    .limit(SINGLE_LEAD_LIMIT);

  if (error) {
    console.warn(`Case pipeline: ${source.table} latest-touch lookup failed`, error);
    return;
  }

  const rows = (data || []) as any[];
  rows.forEach((row) => {
    const rowId = source.toRowId(row);
    if (rowId) considerLatestTouch(latest, rowId, source.toTimestamp(row), row.direction);
  });

  if (rows.length < SINGLE_LEAD_LIMIT) return;

  const directionalValues = {
    inbound: ['inbound', 'in', 'incoming'],
    outbound: ['outbound', 'out', 'outgoing'],
  };
  const [overall, inbound, outbound] = await Promise.all([
    supabase
      .from(source.table)
      .select(source.select)
      .eq(source.idColumn, id)
      .not(source.orderColumn, 'is', null)
      .order(source.orderColumn, { ascending: false })
      .limit(1),
    supabase
      .from(source.table)
      .select(source.select)
      .eq(source.idColumn, id)
      .in('direction', directionalValues.inbound)
      .not(source.orderColumn, 'is', null)
      .order(source.orderColumn, { ascending: false })
      .limit(1),
    supabase
      .from(source.table)
      .select(source.select)
      .eq(source.idColumn, id)
      .in('direction', directionalValues.outbound)
      .not(source.orderColumn, 'is', null)
      .order(source.orderColumn, { ascending: false })
      .limit(1),
  ]);

  [overall, inbound, outbound].forEach((result) => {
    const row = (result.data || [])[0] as any;
    if (!row) return;
    const rowId = source.toRowId(row);
    if (rowId) considerLatestTouch(latest, rowId, source.toTimestamp(row), row.direction);
  });
}

async function runWithConcurrency<T>(
  items: T[],
  limit: number,
  worker: (item: T) => Promise<void>,
): Promise<void> {
  let cursor = 0;
  const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (cursor < items.length) {
      const item = items[cursor++];
      await worker(item);
    }
  });
  await Promise.all(runners);
}

/**
 * Newest row per lead for one table.
 *
 * Deliberately unsorted: adding `order(sent_at desc) limit N` on top of an `IN (...)` filter
 * makes Postgres walk the global timestamp index instead of the lead index, which times out on
 * these tables. Fetching the (small) set of rows belonging to the chunk and reducing in JS keeps
 * the lead index in play. A saturated response means the chunk was bigger than expected, so
 * those leads fall back to one indexed lookup each.
 */
async function collectLatestTouches(
  ids: string[],
  source: TouchSource,
  latest: Map<string, LatestTouch>,
): Promise<void> {
  const CHUNK = 25;
  const HARD_LIMIT = 5000;

  for (const chunk of chunkIds(ids, CHUNK)) {
    if (chunk.length === 0) continue;

    const { data, error } = await supabase
      .from(source.table)
      .select(source.select)
      .in(source.idColumn, chunk)
      .limit(HARD_LIMIT);

    const rows = (data || []) as any[];
    if (!error && rows.length < HARD_LIMIT) {
      rows.forEach((row) => {
        const rowId = source.toRowId(row);
        if (rowId) considerLatestTouch(latest, rowId, source.toTimestamp(row), row.direction);
      });
      continue;
    }

    if (error) {
      console.warn(`Case pipeline: ${source.table} bulk latest-touch failed, falling back`, error);
    }
    await runWithConcurrency(chunk, 6, (id) => collectLatestTouchForId(id, source, latest));
  }
}

/**
 * Latest touch across WhatsApp / email / calls, per row id. The `leads.latest_interaction`
 * column is unreliable, so both the Last interaction column and the awaiting-reply flag are
 * derived from the interaction tables directly — the same ones the interactions modal reads.
 */
export async function fetchLatestTouchByRowId(
  newIds: string[],
  legacyIds: string[],
): Promise<Map<string, LatestTouch>> {
  const latest = new Map<string, LatestTouch>();

  await Promise.all([
    collectLatestTouches(
      newIds,
      {
        table: 'whatsapp_messages',
        idColumn: 'lead_id',
        select: 'lead_id, sent_at, direction',
        orderColumn: 'sent_at',
        toRowId: (r) => (r.lead_id != null ? String(r.lead_id) : null),
        toTimestamp: (r) => r.sent_at,
      },
      latest,
    ),
    collectLatestTouches(
      newIds,
      {
        table: 'emails',
        idColumn: 'client_id',
        select: 'client_id, sent_at, direction',
        orderColumn: 'sent_at',
        toRowId: (r) => (r.client_id != null ? String(r.client_id) : null),
        toTimestamp: (r) => r.sent_at,
      },
      latest,
    ),
    collectLatestTouches(
      newIds,
      {
        table: 'call_logs',
        idColumn: 'client_id',
        select: 'client_id, cdate, time, direction',
        orderColumn: 'cdate',
        toRowId: (r) => (r.client_id != null ? String(r.client_id) : null),
        toTimestamp: (r) => callLogTimestamp(r.cdate, r.time),
      },
      latest,
    ),
    collectLatestTouches(
      legacyIds,
      {
        table: 'whatsapp_messages',
        idColumn: 'legacy_id',
        select: 'legacy_id, sent_at, direction',
        orderColumn: 'sent_at',
        toRowId: (r) => (r.legacy_id != null ? `legacy_${r.legacy_id}` : null),
        toTimestamp: (r) => r.sent_at,
      },
      latest,
    ),
    collectLatestTouches(
      legacyIds,
      {
        table: 'emails',
        idColumn: 'legacy_id',
        select: 'legacy_id, sent_at, direction',
        orderColumn: 'sent_at',
        toRowId: (r) => (r.legacy_id != null ? `legacy_${r.legacy_id}` : null),
        toTimestamp: (r) => r.sent_at,
      },
      latest,
    ),
    collectLatestTouches(
      legacyIds,
      {
        table: 'call_logs',
        idColumn: 'lead_id',
        select: 'lead_id, cdate, time, direction',
        orderColumn: 'cdate',
        toRowId: (r) => (r.lead_id != null ? `legacy_${r.lead_id}` : null),
        toTimestamp: (r) => callLogTimestamp(r.cdate, r.time),
      },
      latest,
    ),
  ]);

  return latest;
}

export async function fetchLatestTouchForLead(
  leadType: 'new' | 'legacy',
  rawId: string,
): Promise<LatestTouch | null> {
  const sources: TouchSource[] =
    leadType === 'new'
      ? [
          {
            table: 'whatsapp_messages',
            idColumn: 'lead_id',
            select: 'lead_id, sent_at, direction',
            orderColumn: 'sent_at',
            toRowId: (r) => (r.lead_id != null ? String(r.lead_id) : null),
            toTimestamp: (r) => r.sent_at,
          },
          {
            table: 'emails',
            idColumn: 'client_id',
            select: 'client_id, sent_at, direction',
            orderColumn: 'sent_at',
            toRowId: (r) => (r.client_id != null ? String(r.client_id) : null),
            toTimestamp: (r) => r.sent_at,
          },
          {
            table: 'call_logs',
            idColumn: 'client_id',
            select: 'client_id, cdate, time, direction',
            orderColumn: 'cdate',
            toRowId: (r) => (r.client_id != null ? String(r.client_id) : null),
            toTimestamp: (r) => callLogTimestamp(r.cdate, r.time),
          },
        ]
      : [
          {
            table: 'whatsapp_messages',
            idColumn: 'legacy_id',
            select: 'legacy_id, sent_at, direction',
            orderColumn: 'sent_at',
            toRowId: (r) => (r.legacy_id != null ? `legacy_${r.legacy_id}` : null),
            toTimestamp: (r) => r.sent_at,
          },
          {
            table: 'emails',
            idColumn: 'legacy_id',
            select: 'legacy_id, sent_at, direction',
            orderColumn: 'sent_at',
            toRowId: (r) => (r.legacy_id != null ? `legacy_${r.legacy_id}` : null),
            toTimestamp: (r) => r.sent_at,
          },
          {
            table: 'call_logs',
            idColumn: 'lead_id',
            select: 'lead_id, cdate, time, direction',
            orderColumn: 'cdate',
            toRowId: (r) => (r.lead_id != null ? `legacy_${r.lead_id}` : null),
            toTimestamp: (r) => callLogTimestamp(r.cdate, r.time),
          },
        ];

  const latest = new Map<string, LatestTouch>();
  await Promise.all(sources.map((source) => collectLatestTouchForId(rawId, source, latest)));
  const rowId = leadType === 'new' ? rawId : `legacy_${rawId}`;
  return latest.get(rowId) || null;
}

/** ISO timestamp for a touch, or the existing value when there is nothing newer. */
export function touchToIso(touch: LatestTouch | null | undefined, current: string | null): string | null {
  if (!touch) return current;
  const currentMs = parseDateMs(current);
  if (currentMs != null && currentMs >= touch.at) return current;
  return new Date(touch.at).toISOString();
}
