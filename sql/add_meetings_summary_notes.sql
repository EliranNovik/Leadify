-- Staff-written meeting summary notes (Meeting tab modal + optional AI polish).

ALTER TABLE public.meetings
ADD COLUMN IF NOT EXISTS meeting_summary_notes text NULL;

COMMENT ON COLUMN public.meetings.meeting_summary_notes IS
  'Free-text meeting summary written by staff in Meeting tab; may be polished via ai-meeting-summary-notes edge function.';
