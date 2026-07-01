-- Persist client IANA timezone at self-booking time (display only; meeting_date/time remain Jerusalem).
ALTER TABLE public.meetings
  ADD COLUMN IF NOT EXISTS client_booking_timezone TEXT NULL;

COMMENT ON COLUMN public.meetings.client_booking_timezone IS
  'IANA timezone detected from client browser at self-booking time (display only; meeting_date/time are Asia/Jerusalem).';
