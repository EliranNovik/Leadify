import { supabase } from './supabase';

export type TranscribeMeetingSummaryAudioInput = {
  audioBase64: string;
  mimeType: string;
  language?: 'he' | 'en' | 'auto';
  prompt?: string;
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

/** Strip markdown / labeled CRM dumps so the brief stays readable in a plain textarea. */
export function cleanMeetingBriefText(raw: string): string {
  let text = String(raw ?? '').replace(/\r\n/g, '\n').trim();
  if (!text) return '';

  text = text.replace(/^#{1,6}\s+/gm, '');
  text = text.replace(/\*\*(.+?)\*\*/g, '$1');
  text = text.replace(/__(.+?)__/g, '$1');
  text = text.replace(/\*([^*\n]+)\*/g, '$1');
  text = text.replace(/\[([^\]]+)\]\((https?:\/\/[^)]+)\)/g, '$1');
  text = text.replace(/`([^`]+)`/g, '$1');
  text = text.replace(/^>\s?/gm, '');
  text = text.replace(/^[-*•]\s+/gm, '');
  text = text.replace(/\n{3,}/g, '\n\n');
  return text.trim();
}

export function hasHebrewText(raw: string): boolean {
  return /[\u0590-\u05FF]/.test(raw);
}

/** Keep the chat reply short — the full brief belongs in the editor, not the bubble. */
export function cleanMeetingBriefChatReply(raw: string, language: 'en' | 'he' = 'en'): string {
  const fallback = language === 'he' ? 'עודכן סיכום הפגישה.' : 'Updated the meeting brief.';
  const cleaned = cleanMeetingBriefText(raw);
  if (!cleaned) return fallback;
  if (cleaned.length > 280 || /\n.*\n/.test(cleaned)) {
    return fallback;
  }
  return cleaned;
}
