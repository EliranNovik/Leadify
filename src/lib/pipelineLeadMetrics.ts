import { supabase } from './supabase';
import { ACTIVE_MEETING_STATUS_FILTER, localTodayYmd } from './meetingRescheduleCancel';
import { chunkIds, fetchLatestTouchByRowId, isAwaitingReply, touchToIso } from './leadLatestTouch';

/**
 * Row-level lead metrics shared by the pipeline pages: the next meeting date and the
 * interaction state behind the Last interaction column and the summary boxes.
 *
 * Row ids follow the pipeline convention: a new lead uses its uuid, a legacy lead `legacy_<id>`.
 */

function toDateKey(value: string | null | undefined): string | null {
  if (!value) return null;
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString().slice(0, 10);
}

/**
 * Prefer the earliest upcoming (today+) meeting; if none, the most recent past one
 * so overdue / completed dates still surface in the Meeting column.
 */
export function pickNextMeetingDate(dates: Array<string | null | undefined>): string | null {
  const keys = dates
    .map((d) => toDateKey(d))
    .filter((k): k is string => Boolean(k))
    .sort();
  if (keys.length === 0) return null;
  const today = localTodayYmd();
  const upcoming = keys.find((k) => k >= today);
  return upcoming ?? keys[keys.length - 1];
}

/** Next meeting date per pipeline row (new leads via client_id, legacy via legacy_lead_id). */
export async function fetchMeetingsByRowId(
  newIds: string[],
  legacyIds: string[],
): Promise<Map<string, string>> {
  const datesByRowId = new Map<string, string[]>();

  const pushDate = (rowId: string, meetingDate: string | null | undefined) => {
    const key = toDateKey(meetingDate);
    if (!key) return;
    const list = datesByRowId.get(rowId);
    if (list) list.push(key);
    else datesByRowId.set(rowId, [key]);
  };

  for (const chunk of chunkIds(newIds, 200)) {
    if (chunk.length === 0) continue;
    const { data, error } = await supabase
      .from('meetings')
      .select('client_id, meeting_date')
      .in('client_id', chunk)
      .or(ACTIVE_MEETING_STATUS_FILTER)
      .limit(20000);
    if (error) {
      console.warn('Pipeline: meetings for new leads failed', error);
      continue;
    }
    (data || []).forEach((row: any) => {
      if (row.client_id) pushDate(String(row.client_id), row.meeting_date);
    });
  }

  for (const chunk of chunkIds(legacyIds, 200)) {
    if (chunk.length === 0) continue;
    const { data, error } = await supabase
      .from('meetings')
      .select('legacy_lead_id, meeting_date')
      .in('legacy_lead_id', chunk)
      .or(ACTIVE_MEETING_STATUS_FILTER)
      .limit(20000);
    if (error) {
      console.warn('Pipeline: meetings for legacy leads failed', error);
      continue;
    }
    (data || []).forEach((row: any) => {
      if (row.legacy_lead_id != null) pushDate(`legacy_${row.legacy_lead_id}`, row.meeting_date);
    });
  }

  const nextByRowId = new Map<string, string>();
  datesByRowId.forEach((dates, rowId) => {
    const next = pickNextMeetingDate(dates);
    if (next) nextByRowId.set(rowId, next);
  });
  return nextByRowId;
}

export async function fetchNextMeetingForLead(
  leadType: 'new' | 'legacy',
  rawId: string,
): Promise<string | null> {
  const query =
    leadType === 'new'
      ? supabase
          .from('meetings')
          .select('meeting_date')
          .eq('client_id', rawId)
          .or(ACTIVE_MEETING_STATUS_FILTER)
          .limit(500)
      : supabase
          .from('meetings')
          .select('meeting_date')
          .eq('legacy_lead_id', Number(rawId))
          .or(ACTIVE_MEETING_STATUS_FILTER)
          .limit(500);

  const { data, error } = await query;
  if (error) {
    console.warn('Pipeline: next meeting fetch failed', error);
    return null;
  }
  return pickNextMeetingDate((data || []).map((r: any) => r.meeting_date));
}

export type PipelineLeadMetrics = {
  last_interaction: string | null;
  awaiting_reply: boolean;
  next_meeting: string | null;
};

/**
 * One-shot fetch of interaction and meeting metrics for a set of leads, used by pages that
 * only need the derived values (the case pipeline drives the same helpers itself so it can
 * patch single rows from realtime events).
 */
export async function fetchPipelineLeadMetrics(
  newIds: string[],
  legacyIds: string[],
): Promise<Map<string, PipelineLeadMetrics>> {
  const [touches, meetings] = await Promise.all([
    fetchLatestTouchByRowId(newIds, legacyIds),
    fetchMeetingsByRowId(newIds, legacyIds),
  ]);

  const metrics = new Map<string, PipelineLeadMetrics>();
  const rowIds = new Set<string>([...newIds, ...legacyIds.map((id) => `legacy_${id}`)]);
  rowIds.forEach((rowId) => {
    const touch = touches.get(rowId) || null;
    metrics.set(rowId, {
      last_interaction: touchToIso(touch, null),
      awaiting_reply: isAwaitingReply(touch),
      next_meeting: meetings.get(rowId) || null,
    });
  });
  return metrics;
}
