import { supabase } from './supabase';

export interface OutlookTeamsMeeting {
  id?: number;
  teams_meeting_id: string;
  subject: string;
  start_date_time: string;
  end_date_time: string;
  teams_join_url?: string;
  teams_meeting_url?: string;
  calendar_id: string;
  attendees?: string[];
  description?: string;
  location?: string;
  created_by: string;
  created_at?: string;
  updated_at?: string;
  status?: string;
  is_online_meeting?: boolean;
  online_meeting_provider?: string;
}

export interface CreateTeamsMeetingResult {
  joinUrl: string;
  id: string;
  onlineMeeting: any;
}

/**
 * Save Teams meeting data to the database
 */
export async function saveOutlookTeamsMeeting(
  meetingData: OutlookTeamsMeeting
): Promise<{ data: any; error: any }> {
  try {
    const { data, error } = await supabase
      .from('outlook_teams_meetings')
      .insert([meetingData])
      .select()
      .single();

    if (error) {
      return { data: null, error };
    }
    return { data, error: null };
  } catch (error) {
    return { data: null, error };
  }
}

/**
 * Get Teams meetings for a specific calendar
 */
export async function getOutlookTeamsMeetings(
  calendarId?: string,
  startDate?: string,
  endDate?: string
): Promise<{ data: OutlookTeamsMeeting[]; error: any }> {
  try {
    let query = supabase
      .from('outlook_teams_meetings')
      .select('*')
      .order('start_date_time', { ascending: true });

    if (calendarId) {
      query = query.eq('calendar_id', calendarId);
    }

    if (startDate) {
      query = query.gte('start_date_time', startDate);
    }

    if (endDate) {
      query = query.lte('start_date_time', endDate);
    }

    const { data, error } = await query;

    if (error) {
      console.error('Error fetching Teams meetings:', error);
      return { data: [], error };
    }

    return { data: data || [], error: null };
  } catch (error) {
    console.error('Exception fetching Teams meetings:', error);
    return { data: [], error };
  }
}

/**
 * Get a specific Teams meeting by ID
 */
export async function getOutlookTeamsMeeting(
  teamsMeetingId: string
): Promise<{ data: OutlookTeamsMeeting | null; error: any }> {
  try {
    const { data, error } = await supabase
      .from('outlook_teams_meetings')
      .select('*')
      .eq('teams_meeting_id', teamsMeetingId)
      .single();

    if (error) {
      console.error('Error fetching Teams meeting:', error);
      return { data: null, error };
    }

    return { data, error: null };
  } catch (error) {
    console.error('Exception fetching Teams meeting:', error);
    return { data: null, error };
  }
}

const CALENDAR_ROW_NOT_SAVED =
  'The calendar time was not saved. Apply the staff meeting permission, then save again.';

const CALENDAR_ROW_NOT_REMOVED =
  'The meeting was updated in the case, but the calendar slot was not removed. Apply the staff meeting permission, then delete it again.';

/**
 * Move the shared staff-calendar row the calendar page reads.
 * A blocked update returns no error and no row. If the row is still visible, that is a failure.
 * Returns `missing` when there is no calendar row to move.
 */
export async function syncOutlookTeamsMeetingSchedule(
  teamsMeetingId: string,
  updates: {
    subject?: string;
    start_date_time: string;
    end_date_time: string;
    description?: string | null;
    location?: string | null;
  }
): Promise<'updated' | 'missing'> {
  const id = String(teamsMeetingId || '').trim();
  if (!id) return 'missing';

  const { data, error } = await supabase
    .from('outlook_teams_meetings')
    .update({
      ...updates,
      updated_at: new Date().toISOString(),
    })
    .eq('teams_meeting_id', id)
    .select('teams_meeting_id, start_date_time');

  if (error) throw error;
  if (data && data.length > 0) return 'updated';

  const { data: existing, error: readError } = await supabase
    .from('outlook_teams_meetings')
    .select('teams_meeting_id')
    .eq('teams_meeting_id', id)
    .limit(1);

  if (readError) throw readError;
  if (!existing || existing.length === 0) return 'missing';
  throw new Error(CALENDAR_ROW_NOT_SAVED);
}

/**
 * Remove the shared staff-calendar row so a canceled or deleted internal meeting leaves the calendar.
 * Returns `missing` when there is no row. Throws when the row is still visible after delete.
 */
export async function removeOutlookTeamsMeetingRow(
  teamsMeetingId: string
): Promise<'removed' | 'missing'> {
  const id = String(teamsMeetingId || '').trim();
  if (!id) return 'missing';

  const { data: existing, error: readError } = await supabase
    .from('outlook_teams_meetings')
    .select('teams_meeting_id')
    .eq('teams_meeting_id', id)
    .limit(1);

  if (readError) throw readError;
  if (!existing || existing.length === 0) return 'missing';

  const { data, error } = await supabase
    .from('outlook_teams_meetings')
    .delete()
    .eq('teams_meeting_id', id)
    .select('teams_meeting_id');

  if (error) throw error;
  if (!data || data.length === 0) throw new Error(CALENDAR_ROW_NOT_REMOVED);
  return 'removed';
}

/**
 * Update Teams meeting data
 */
export async function updateOutlookTeamsMeeting(
  teamsMeetingId: string,
  updates: Partial<OutlookTeamsMeeting>
): Promise<{ data: any; error: any }> {
  try {
    const { data, error } = await supabase
      .from('outlook_teams_meetings')
      .update(updates)
      .eq('teams_meeting_id', teamsMeetingId)
      .select()
      .single();

    if (error) {
      console.error('Error updating Teams meeting:', error);
      return { data: null, error };
    }

    return { data, error: null };
  } catch (error) {
    console.error('Exception updating Teams meeting:', error);
    return { data: null, error };
  }
}

/**
 * Delete Teams meeting
 */
export async function deleteOutlookTeamsMeeting(
  teamsMeetingId: string
): Promise<{ data: any; error: any }> {
  try {
    const { data, error } = await supabase
      .from('outlook_teams_meetings')
      .delete()
      .eq('teams_meeting_id', teamsMeetingId)
      .select()
      .single();

    if (error) {
      console.error('Error deleting Teams meeting:', error);
      return { data: null, error };
    }

    return { data, error: null };
  } catch (error) {
    console.error('Exception deleting Teams meeting:', error);
    return { data: null, error };
  }
}
