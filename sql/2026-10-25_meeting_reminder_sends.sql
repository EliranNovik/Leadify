-- One row per meeting reminder actually delivered, so the Calendar can mark a meeting as
-- already reminded. Written by the bulk reminder drawer and by the single-meeting reminder
-- buttons in MeetingTab / MeetingNotifyControls.
--
-- Keyed by row_key rather than meeting_id alone because the Calendar list mixes two sources:
-- public.meetings rows (row_key = the numeric id) and legacy rows that live on
-- public.leads_lead and carry their meeting on the lead itself (row_key = 'legacy_<id>').
-- meeting_id / legacy_lead_id are kept alongside for joins and cascade deletes.
--
-- History is kept: re-reminding a meeting inserts another row, and the UI reads the latest.
-- Safe to re-run.

CREATE TABLE IF NOT EXISTS public.meeting_reminder_sends (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  row_key text NOT NULL,
  meeting_id integer NULL REFERENCES public.meetings (id) ON DELETE CASCADE,
  legacy_lead_id bigint NULL,
  channel text NOT NULL CHECK (channel IN ('whatsapp', 'email')),
  -- Template language the reminder actually went out in ('he' / 'en').
  language text NULL,
  recipient_count integer NOT NULL DEFAULT 0,
  sent_at timestamptz NOT NULL DEFAULT now(),
  sent_by text NULL,
  sent_by_employee_id bigint NULL
);

-- The Calendar looks these up by the row keys currently on screen.
CREATE INDEX IF NOT EXISTS idx_meeting_reminder_sends_row_key
  ON public.meeting_reminder_sends (row_key, sent_at DESC);

CREATE INDEX IF NOT EXISTS idx_meeting_reminder_sends_meeting_id
  ON public.meeting_reminder_sends (meeting_id);

ALTER TABLE public.meeting_reminder_sends ENABLE ROW LEVEL SECURITY;

-- Any signed-in member of staff may see and add reminder records; nobody edits or deletes them,
-- since they are a log of what was sent.
DROP POLICY IF EXISTS "meeting_reminder_sends_select" ON public.meeting_reminder_sends;
CREATE POLICY "meeting_reminder_sends_select" ON public.meeting_reminder_sends
  FOR SELECT USING (auth.uid() IS NOT NULL);

DROP POLICY IF EXISTS "meeting_reminder_sends_insert" ON public.meeting_reminder_sends;
CREATE POLICY "meeting_reminder_sends_insert" ON public.meeting_reminder_sends
  FOR INSERT WITH CHECK (auth.uid() IS NOT NULL);

GRANT SELECT, INSERT ON public.meeting_reminder_sends TO authenticated;

SELECT column_name, data_type, is_nullable
FROM information_schema.columns
WHERE table_schema = 'public' AND table_name = 'meeting_reminder_sends'
ORDER BY ordinal_position;
