import { supabase as defaultSupabase } from './supabase';

type MeetingsClient = typeof defaultSupabase;

/** Local calendar date as YYYY-MM-DD (avoids UTC day skew from toISOString). */
export function localTodayYmd(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/**
 * Active meetings filter for PostgREST `.or(...)`.
 * Avoid `not.in.(a,b)` inside `or()` — commas break OR parsing.
 * Nested `and(...)` keeps canceled/cancelled both excluded.
 */
export const ACTIVE_MEETING_STATUS_FILTER =
  'status.is.null,and(status.neq.canceled,status.neq.cancelled)';

export function parseLegacyLeadId(clientId: string | number): number | string {
  const raw = String(clientId).replace(/^legacy_/i, '');
  return /^\d+$/.test(raw) ? parseInt(raw, 10) : raw;
}

export type MeetingCancelCandidate = {
  id: number;
  meeting_date?: string | null;
  meeting_time?: string | null;
  meeting_location?: string | null;
  meeting_location_old?: string | null;
  scheduler?: string | null;
  status?: string | null;
  [key: string]: unknown;
};

function isCanceledStatus(status: unknown): boolean {
  const normalized = String(status ?? '')
    .trim()
    .toLowerCase();
  return normalized === 'canceled' || normalized === 'cancelled';
}

type FindArgs = {
  supabase: MeetingsClient;
  clientId: string | number;
  isLegacyLead: boolean;
  /** Meeting chosen in the reschedule UI, if any. */
  preferredMeetingId?: number | null;
  /** Extra columns beyond id/date/time/location. */
  select?: string;
};

/**
 * Resolve which prior meeting to cancel when booking a replacement.
 * Prefers the UI selection, then oldest upcoming active meeting, then any active meeting.
 */
export async function findMeetingToCancelOnReschedule(
  args: FindArgs,
): Promise<MeetingCancelCandidate | null> {
  const {
    supabase,
    clientId,
    isLegacyLead,
    preferredMeetingId = null,
    select = 'id, meeting_date, meeting_time, meeting_location, meeting_location_old, scheduler, status',
  } = args;

  const withLead = (query: any) => {
    if (isLegacyLead) {
      return query.eq('legacy_lead_id', parseLegacyLeadId(clientId));
    }
    return query.eq('client_id', clientId);
  };

  if (preferredMeetingId != null && Number.isFinite(Number(preferredMeetingId))) {
    const { data, error } = await withLead(
      supabase.from('meetings').select(select).eq('id', Number(preferredMeetingId)),
    ).maybeSingle();
    if (error) {
      console.error('findMeetingToCancelOnReschedule preferred lookup failed:', error);
    } else if (data && !isCanceledStatus((data as unknown as MeetingCancelCandidate).status)) {
      return data as unknown as MeetingCancelCandidate;
    }
  }

  const today = localTodayYmd();

  const { data: upcoming, error: upcomingError } = await withLead(
    supabase
      .from('meetings')
      .select(select)
      .or(ACTIVE_MEETING_STATUS_FILTER)
      .gte('meeting_date', today)
      .order('meeting_date', { ascending: true })
      .order('meeting_time', { ascending: true })
      .limit(1),
  );

  if (upcomingError) {
    console.error('findMeetingToCancelOnReschedule upcoming lookup failed:', upcomingError);
  } else if (upcoming && upcoming.length > 0) {
    return upcoming[0] as unknown as MeetingCancelCandidate;
  }

  // Fallback: any active meeting for this lead (covers timezone edge cases / same-day past slots).
  const { data: anyActive, error: anyError } = await withLead(
    supabase
      .from('meetings')
      .select(select)
      .or(ACTIVE_MEETING_STATUS_FILTER)
      .order('meeting_date', { ascending: false })
      .order('meeting_time', { ascending: false })
      .limit(1),
  );

  if (anyError) {
    console.error('findMeetingToCancelOnReschedule fallback lookup failed:', anyError);
    return null;
  }
  if (anyActive && anyActive.length > 0) {
    return anyActive[0] as unknown as MeetingCancelCandidate;
  }
  return null;
}

type CancelArgs = {
  supabase: MeetingsClient;
  meetingId: number;
  editorDisplayName: string;
  /** Do not cancel this id (the newly inserted replacement). */
  excludeMeetingId?: number | null;
};

/**
 * Mark a meeting canceled and return the updated row (or null if nothing updated).
 * Filters by id only — do not combine `.or(status...)` on update (PostgREST OR/comma bugs
 * caused 0-row updates and false "cancel failed" toasts).
 */
export async function cancelMeetingById(
  args: CancelArgs,
): Promise<MeetingCancelCandidate | null> {
  const { supabase, meetingId, editorDisplayName, excludeMeetingId = null } = args;
  const id = Number(meetingId);
  if (!Number.isFinite(id)) {
    console.warn('cancelMeetingById invalid meeting id', meetingId);
    return null;
  }
  if (excludeMeetingId != null && id === Number(excludeMeetingId)) {
    console.warn('cancelMeetingById refused to cancel the newly created meeting', id);
    return null;
  }

  const { data, error } = await supabase
    .from('meetings')
    .update({
      status: 'canceled',
      last_edited_timestamp: new Date().toISOString(),
      last_edited_by: editorDisplayName,
    })
    .eq('id', id)
    .select('*')
    .maybeSingle();

  if (error) {
    throw error;
  }

  if (data) {
    return data as unknown as MeetingCancelCandidate;
  }

  // Update may return no row under some RLS/select Prefer setups — verify by re-read.
  const { data: existing, error: readError } = await supabase
    .from('meetings')
    .select('*')
    .eq('id', id)
    .maybeSingle();

  if (readError) {
    throw readError;
  }
  if (existing && isCanceledStatus((existing as MeetingCancelCandidate).status)) {
    return existing as unknown as MeetingCancelCandidate;
  }

  console.warn('cancelMeetingById updated 0 rows for meeting', id, {
    existingStatus: (existing as MeetingCancelCandidate | null)?.status ?? null,
  });
  return null;
}
