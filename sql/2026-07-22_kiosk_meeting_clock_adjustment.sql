-- Entry kiosk: meeting-aware clock in/out adjustments.
-- Depends on meetings.duration (also ensured below). Apply in Supabase before using this feature.

-- 1) Meeting duration (idempotent; same as 2026-07-22_meetings_duration.sql)
ALTER TABLE public.meetings
  ADD COLUMN IF NOT EXISTS duration INTEGER NULL;

COMMENT ON COLUMN public.meetings.duration IS
  'Meeting length in minutes. Start time is meetings.meeting_time; end = start + duration.';

UPDATE public.meetings
SET duration = 60
WHERE duration IS NULL;

-- 2) Index for kiosk day lookups by date/time
CREATE INDEX IF NOT EXISTS idx_meetings_date_time_status
  ON public.meetings (meeting_date, meeting_time)
  WHERE status IS DISTINCT FROM 'canceled';

-- meeting_participants.employee_id index already from 2026-04-30_meeting_participants_and_firm_contacts.sql

-- 3) Flash table: persist action + remark for multi-instance tablet read-after-write
ALTER TABLE public.clock_in_kiosk_flash
  ADD COLUMN IF NOT EXISTS action text;

ALTER TABLE public.clock_in_kiosk_flash
  ADD COLUMN IF NOT EXISTS remark text;

COMMENT ON COLUMN public.clock_in_kiosk_flash.action IS
  'Clock action for welcome modal: in or out.';

COMMENT ON COLUMN public.clock_in_kiosk_flash.remark IS
  'Optional meeting-aware welcome/goodbye line shown with the flash modal.';

ALTER TABLE public.clock_in_kiosk_flash
  ADD COLUMN IF NOT EXISTS adjusted_at timestamptz;

COMMENT ON COLUMN public.clock_in_kiosk_flash.adjusted_at IS
  'Meeting-adjusted clock in/out timestamp shown on the kiosk modal (meeting start on in, meeting end on out). NULL = use created_at / wall clock.';

-- 4) Document that entry kiosk may backdate/forward-date clock times for meeting alignment
COMMENT ON COLUMN public.employee_clock_in.clock_in_time IS
  'Timestamp when employee clocked in. Entry kiosk QR may set this to a past meeting start when the employee had a meeting earlier today.';

COMMENT ON COLUMN public.employee_clock_in.clock_out_time IS
  'Timestamp when employee clocked out (NULL if still clocked in). Entry kiosk QR may set this to a future meeting end when the employee has an upcoming meeting today.';
