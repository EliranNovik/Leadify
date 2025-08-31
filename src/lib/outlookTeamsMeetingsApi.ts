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
      console.error('Error saving Teams meeting to database:', error);
      return { data: null, error };
    }

    console.log('Teams meeting saved to database:', data);
    return { data, error: null };
  } catch (error) {
    console.error('Exception saving Teams meeting to database:', error);
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
