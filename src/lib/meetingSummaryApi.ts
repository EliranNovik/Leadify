import { supabase } from './supabase';

export interface MeetingSummary {
  id: string;
  meeting_id: string;
  summary_he: string;
  summary_en: string;
  model: string;
  tokens_used: number;
  language_detected: string;
  action_items: any[];
  risks: string[];
  created_at: string;
  updated_at: string;
}

export interface MeetingTranscript {
  id: string;
  meeting_id: string;
  text: string;
  source: string;
  language: string;
  raw_transcript?: string;
  created_at: string;
  updated_at: string;
}

export interface MeetingQuestionnaire {
  id: string;
  meeting_id: string;
  payload: any;
  version: string;
  created_at: string;
  updated_at: string;
}

export interface ProcessMeetingSummaryRequest {
  meetingId: string;
  clientId: string;
  userId?: string; // User ID for Graph API access
  transcriptText?: string; // Optional - will fetch from Teams if not provided
  transcriptUrl?: string;
  meetingSubject?: string;
  meetingStartTime?: string;
  meetingEndTime?: string;
  autoFetchTranscript?: boolean; // Whether to automatically fetch from Teams
}

export interface ProcessMeetingSummaryResponse {
  success: boolean;
  meetingId?: string;
  summaryId?: string;
  error?: string;
  transcriptSource?: 'manual' | 'teams' | 'none';
}

// Process meeting transcript and generate summary
export async function processMeetingSummary(
  request: ProcessMeetingSummaryRequest
): Promise<ProcessMeetingSummaryResponse> {
  try {
    const { data, error } = await supabase.functions.invoke('meeting-summary', {
      body: request
    });

    if (error) {
      console.error('Error processing meeting summary:', error);
      return {
        success: false,
        error: error.message || 'Failed to process meeting summary'
      };
    }

    return data as ProcessMeetingSummaryResponse;
  } catch (error) {
    console.error('Error calling meeting summary function:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error'
    };
  }
}

// Process meeting summary with automatic Teams transcript fetching
export async function processMeetingSummaryWithTeamsFetch(
  meetingId: string,
  clientId: string,
  userId: string,
  options?: {
    transcriptText?: string;
    transcriptUrl?: string;
    meetingSubject?: string;
    meetingStartTime?: string;
    meetingEndTime?: string;
    autoFetchTranscript?: boolean;
  }
): Promise<ProcessMeetingSummaryResponse> {
  const request: ProcessMeetingSummaryRequest = {
    meetingId,
    clientId,
    userId,
    autoFetchTranscript: options?.autoFetchTranscript ?? true,
    transcriptText: options?.transcriptText,
    transcriptUrl: options?.transcriptUrl,
    meetingSubject: options?.meetingSubject,
    meetingStartTime: options?.meetingStartTime,
    meetingEndTime: options?.meetingEndTime,
  };

  return processMeetingSummary(request);
}

// Get meeting summary by meeting ID
export async function getMeetingSummary(meetingId: string | number): Promise<MeetingSummary | null> {
  try {
    const { data, error } = await supabase
      .from('meeting_summaries')
      .select('*')
      .eq('meeting_id', meetingId)
      .single();

    if (error) {
      console.error('Error fetching meeting summary:', error);
      return null;
    }

    return data;
  } catch (error) {
    console.error('Error getting meeting summary:', error);
    return null;
  }
}

// Get meeting transcript by meeting ID
export async function getMeetingTranscript(meetingId: string | number): Promise<MeetingTranscript | null> {
  try {
    const { data, error } = await supabase
      .from('meeting_transcripts')
      .select('*')
      .eq('meeting_id', meetingId)
      .single();

    if (error) {
      console.error('Error fetching meeting transcript:', error);
      return null;
    }

    return data;
  } catch (error) {
    console.error('Error getting meeting transcript:', error);
    return null;
  }
}

// Get meeting questionnaire by meeting ID
export async function getMeetingQuestionnaire(meetingId: string | number): Promise<MeetingQuestionnaire | null> {
  try {
    const { data, error } = await supabase
      .from('meeting_questionnaires')
      .select('*')
      .eq('meeting_id', meetingId)
      .single();

    if (error) {
      console.error('Error fetching meeting questionnaire:', error);
      return null;
    }

    return data;
  } catch (error) {
    console.error('Error getting meeting questionnaire:', error);
    return null;
  }
}

// Get all meeting data (summary, transcript, questionnaire) by meeting ID
export async function getMeetingData(meetingId: string | number) {
  try {
    const [summary, transcript, questionnaire] = await Promise.all([
      getMeetingSummary(meetingId),
      getMeetingTranscript(meetingId),
      getMeetingQuestionnaire(meetingId)
    ]);

    return {
      summary,
      transcript,
      questionnaire
    };
  } catch (error) {
    console.error('Error getting meeting data:', error);
    return {
      summary: null,
      transcript: null,
      questionnaire: null
    };
  }
}

// Regenerate meeting summary with custom prompt
export async function regenerateMeetingSummary(
  meetingId: string | number,
  customPrompt?: string
): Promise<ProcessMeetingSummaryResponse> {
  try {
    // First get the transcript
    const transcript = await getMeetingTranscript(meetingId);
    if (!transcript) {
      return {
        success: false,
        error: 'No transcript found for this meeting'
      };
    }

    // Get the meeting details
    const { data: meeting, error: meetingError } = await supabase
      .from('meetings')
      .select('*')
      .eq('id', meetingId)
      .single();

    if (meetingError || !meeting) {
      return {
        success: false,
        error: 'Meeting not found'
      };
    }

    // Process with the transcript
    const request: ProcessMeetingSummaryRequest = {
      meetingId: meeting.teams_id || meetingId,
      clientId: meeting.client_id,
      transcriptText: transcript.text,
      transcriptUrl: meeting.transcript_url,
      meetingSubject: meeting.meeting_subject,
      meetingStartTime: meeting.started_at,
      meetingEndTime: meeting.ended_at
    };

    return await processMeetingSummary(request);
  } catch (error) {
    console.error('Error regenerating meeting summary:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error'
    };
  }
}

// Update client auto-email preference
export async function updateClientAutoEmailPreference(
  clientId: string,
  autoEmail: boolean,
  languagePreference?: string
): Promise<boolean> {
  try {
    const updateData: any = {
      auto_email_meeting_summary: autoEmail
    };

    if (languagePreference) {
      updateData.language_preference = languagePreference;
    }

    const { error } = await supabase
      .from('leads')
      .update(updateData)
      .eq('id', clientId);

    if (error) {
      console.error('Error updating client auto-email preference:', error);
      return false;
    }

    return true;
  } catch (error) {
    console.error('Error updating client preference:', error);
    return false;
  }
}

// Send meeting summary email to client
export async function sendMeetingSummaryEmail(
  clientId: string,
  meetingId: string,
  summaryText: string,
  language: 'he' | 'en' = 'en'
): Promise<boolean> {
  try {
    const subject = language === 'he' 
      ? 'סיכום הפגישה' 
      : 'Meeting Summary';

    const { error } = await supabase
      .from('emails')
      .insert({
        client_id: clientId,
        subject: subject,
        body_preview: summaryText.substring(0, 200) + '...',
        direction: 'outgoing',
        sent_at: new Date().toISOString(),
        related_meeting_id: meetingId
      });

    if (error) {
      console.error('Error sending meeting summary email:', error);
      return false;
    }

    return true;
  } catch (error) {
    console.error('Error sending meeting summary email:', error);
    return false;
  }
}

// Manual trigger for meeting summary processing
export async function triggerMeetingSummaryProcessing(
  meetingId: string | number,
  clientId: string,
  options?: {
    transcriptText?: string;
    transcriptUrl?: string;
    meetingSubject?: string;
    meetingStartTime?: string;
    meetingEndTime?: string;
    autoFetchTranscript?: boolean;
  }
): Promise<ProcessMeetingSummaryResponse> {
  try {
    console.log('🔧 Manually triggering meeting summary processing for meeting:', meetingId);
    
    // Get current user for Graph API access
    const { data: { user }, error: userError } = await supabase.auth.getUser();
    if (userError || !user) {
      console.error('Error getting current user:', userError);
      return {
        success: false,
        error: 'User not authenticated'
      };
    }
    
    const request: ProcessMeetingSummaryRequest = {
      meetingId: meetingId.toString(),
      clientId,
      userId: user.id, // Pass user ID for Graph API access
      autoFetchTranscript: options?.autoFetchTranscript ?? true,
      transcriptText: options?.transcriptText,
      transcriptUrl: options?.transcriptUrl,
      meetingSubject: options?.meetingSubject,
      meetingStartTime: options?.meetingStartTime,
      meetingEndTime: options?.meetingEndTime
    };

    const result = await processMeetingSummary(request);
    console.log('Meeting summary processing result:', result);
    
    return result;
  } catch (error) {
    console.error('Error triggering meeting summary processing:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error'
    };
  }
}
