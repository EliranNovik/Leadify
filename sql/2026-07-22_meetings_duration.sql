-- Meeting duration in minutes (start time remains meetings.meeting_time).
ALTER TABLE public.meetings
  ADD COLUMN IF NOT EXISTS duration INTEGER NULL;

COMMENT ON COLUMN public.meetings.duration IS
  'Meeting length in minutes. Start time is meetings.meeting_time; end = start + duration.';

-- Existing rows: treat as 60 minutes when duration was never stored.
UPDATE public.meetings
SET duration = 60
WHERE duration IS NULL;
