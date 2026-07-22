-- Persist meeting-adjusted clock time on kiosk flash (idempotent).
-- Apply if you already ran 2026-07-22_kiosk_meeting_clock_adjustment.sql before adjusted_at was added.

ALTER TABLE public.clock_in_kiosk_flash
  ADD COLUMN IF NOT EXISTS adjusted_at timestamptz;

COMMENT ON COLUMN public.clock_in_kiosk_flash.adjusted_at IS
  'Meeting-adjusted clock in/out timestamp shown on the kiosk modal (meeting start on in, meeting end on out). NULL = use created_at / wall clock.';
