import { supabase } from './supabase';
import {
  replaceMeetingParticipants,
  type MeetingParticipantsSelection,
  type FreeMeetingParticipant,
} from './meetingParticipants';

export type RecruitmentMeeting = {
  id: number;
  user_id: string | null;
  date: string | null;
  time: string | null;
  duration: number | null;
  location: string | null;
  brief: string | null;
  subject: string | null;
  teams_meeting_url: string | null;
  calendar_type: string | null;
  status: string | null;
  created_at: string | null;
};

function mapMeetingRow(row: any): RecruitmentMeeting {
  return {
    id: Number(row.id),
    user_id: row.user_id ? String(row.user_id) : null,
    date: row.meeting_date ?? row.date ?? null,
    time: row.meeting_time ?? row.time ?? null,
    duration: row.duration != null ? Number(row.duration) : null,
    location: row.meeting_location ?? row.location ?? null,
    brief: row.meeting_brief ?? row.brief ?? null,
    subject: row.meeting_subject ?? null,
    teams_meeting_url: row.teams_meeting_url ?? null,
    calendar_type: row.calendar_type ?? null,
    status: row.status ?? null,
    created_at: row.created_at ?? null,
  };
}

const MEETING_SELECT =
  'id, user_id, meeting_date, meeting_time, duration, meeting_location, meeting_brief, meeting_subject, teams_meeting_url, calendar_type, status, created_at';

export async function fetchRecruitmentMeetings(userId: string): Promise<RecruitmentMeeting[]> {
  const { data, error } = await supabase
    .from('meetings')
    .select(MEETING_SELECT)
    .eq('user_id', userId)
    .order('meeting_date', { ascending: false })
    .order('meeting_time', { ascending: false });

  if (error) throw error;
  return (data || []).map(mapMeetingRow);
}

export async function createRecruitmentMeeting(params: {
  userId: string;
  candidateName: string;
  date: string;
  time: string;
  duration: number;
  location: string;
  brief?: string | null;
  teamsMeetingUrl?: string | null;
  manager?: string | null;
  helper?: string | null;
  participants?: MeetingParticipantsSelection;
  freeDraft?: FreeMeetingParticipant | null;
}): Promise<RecruitmentMeeting> {
  const subject = `Job Interview — ${params.candidateName}`.trim();
  const insertPayload: Record<string, unknown> = {
    user_id: params.userId,
    client_id: null,
    legacy_lead_id: null,
    meeting_date: params.date,
    meeting_time: params.time,
    duration: params.duration,
    meeting_location: params.location,
    meeting_subject: subject,
    meeting_brief: params.brief?.trim() || null,
    teams_meeting_url: params.teamsMeetingUrl || null,
    calendar_type: 'recruitment',
    status: 'scheduled',
    meeting_manager: params.manager || '',
    helper: params.helper || '---',
    meeting_currency: '₪',
    meeting_amount: 0,
  };

  const { data, error } = await supabase
    .from('meetings')
    .insert([insertPayload])
    .select(MEETING_SELECT)
    .single();

  if (error) throw error;
  const meeting = mapMeetingRow(data);

  if (params.participants) {
    await replaceMeetingParticipants(meeting.id, params.participants, params.freeDraft);
  }

  return meeting;
}

export async function updateRecruitmentMeeting(
  meetingId: number,
  patch: Partial<{
    date: string;
    time: string;
    duration: number;
    location: string;
    brief: string | null;
    subject: string | null;
    teams_meeting_url: string | null;
    status: string;
    manager: string | null;
    helper: string | null;
  }>,
  participants?: MeetingParticipantsSelection,
  freeDraft?: FreeMeetingParticipant | null,
): Promise<void> {
  const updatePayload: Record<string, unknown> = {};
  if (patch.date !== undefined) updatePayload.meeting_date = patch.date;
  if (patch.time !== undefined) updatePayload.meeting_time = patch.time;
  if (patch.duration !== undefined) updatePayload.duration = patch.duration;
  if (patch.location !== undefined) updatePayload.meeting_location = patch.location;
  if (patch.brief !== undefined) updatePayload.meeting_brief = patch.brief;
  if (patch.subject !== undefined) updatePayload.meeting_subject = patch.subject;
  if (patch.teams_meeting_url !== undefined) {
    updatePayload.teams_meeting_url = patch.teams_meeting_url;
  }
  if (patch.status !== undefined) updatePayload.status = patch.status;
  if (patch.manager !== undefined) updatePayload.meeting_manager = patch.manager;
  if (patch.helper !== undefined) updatePayload.helper = patch.helper;

  if (Object.keys(updatePayload).length > 0) {
    const { error } = await supabase.from('meetings').update(updatePayload).eq('id', meetingId);
    if (error) throw error;
  }

  if (participants) {
    await replaceMeetingParticipants(meetingId, participants, freeDraft);
  }
}

export async function cancelRecruitmentMeeting(meetingId: number): Promise<void> {
  const { error } = await supabase
    .from('meetings')
    .update({ status: 'canceled' })
    .eq('id', meetingId);
  if (error) throw error;
}

export function nextUpcomingMeeting(
  meetings: RecruitmentMeeting[],
): RecruitmentMeeting | null {
  const now = Date.now();
  const upcoming = meetings
    .filter((m) => {
      if (String(m.status || '').toLowerCase() === 'canceled') return false;
      if (!m.date) return false;
      const t = new Date(`${m.date}T${m.time || '00:00'}`).getTime();
      return Number.isFinite(t) && t >= now - 60 * 60 * 1000;
    })
    .sort((a, b) => {
      const ta = new Date(`${a.date}T${a.time || '00:00'}`).getTime();
      const tb = new Date(`${b.date}T${b.time || '00:00'}`).getTime();
      return ta - tb;
    });
  return upcoming[0] ?? null;
}
