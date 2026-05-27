import { supabase } from './supabase';

export type TranscribeMeetingSummaryAudioInput = {
  audioBase64: string;
  mimeType: string;
  language?: 'he' | 'en' | 'auto';
};

export async function transcribeMeetingSummaryAudio(
  input: TranscribeMeetingSummaryAudioInput,
): Promise<{ transcript: string }> {
  const { data, error } = await supabase.functions.invoke('meeting-summary-transcribe', {
    body: input,
  });

  if (error) {
    throw new Error(error.message || 'Failed to transcribe recording');
  }

  if (data?.error) {
    throw new Error(String(data.error));
  }

  if (!data?.transcript || typeof data.transcript !== 'string') {
    throw new Error('Transcription returned empty text');
  }

  return { transcript: data.transcript };
}

export type PolishMeetingSummaryNotesInput = {
  draft: string;
  clientName?: string | null;
  leadNumber?: string | null;
  meetingDate?: string | null;
  meetingLocation?: string | null;
};

export async function polishMeetingSummaryNotes(
  input: PolishMeetingSummaryNotesInput,
): Promise<{ summary: string }> {
  const { data, error } = await supabase.functions.invoke('ai-meeting-summary-notes', {
    body: input,
  });

  if (error) {
    throw new Error(error.message || 'Failed to generate AI summary');
  }

  if (data?.error) {
    throw new Error(String(data.error));
  }

  if (!data?.summary || typeof data.summary !== 'string') {
    throw new Error('AI returned an invalid summary');
  }

  return { summary: data.summary };
}

export async function fetchMeetingSummaryNotes(meetingId: number): Promise<string> {
  const { data, error } = await supabase
    .from('meetings')
    .select('meeting_summary_notes')
    .eq('id', meetingId)
    .maybeSingle();

  if (error) {
    throw new Error(error.message || 'Failed to load meeting summary');
  }

  return data?.meeting_summary_notes?.trim() || '';
}

export async function saveMeetingSummaryNotes(
  meetingId: number,
  notes: string,
  editorDisplayName: string,
): Promise<void> {
  const { error } = await supabase
    .from('meetings')
    .update({
      meeting_summary_notes: notes.trim() || null,
      last_edited_timestamp: new Date().toISOString(),
      last_edited_by: editorDisplayName,
    })
    .eq('id', meetingId);

  if (error) {
    throw new Error(error.message || 'Failed to save meeting summary');
  }
}
