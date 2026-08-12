-- Fix meeting 4529 calendar_type → active_client
--
-- The previous update failed because the value was mistyped as `avtive_client`
-- (missing "c"). Allowed values for meetings_calendar_type_check are:
--   potential_client | active_client | staff | recruitment

-- Ensure the check constraint includes active_client (safe no-op if already correct)
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'meetings_calendar_type_check'
  ) THEN
    ALTER TABLE public.meetings DROP CONSTRAINT meetings_calendar_type_check;
  END IF;
EXCEPTION WHEN undefined_table THEN
  NULL;
END $$;

ALTER TABLE public.meetings
  ADD CONSTRAINT meetings_calendar_type_check CHECK (
    (calendar_type)::text = ANY (
      (ARRAY[
        'potential_client'::character varying,
        'active_client'::character varying,
        'staff'::character varying,
        'recruitment'::character varying
      ])::text[]
    )
  );

UPDATE public.meetings
SET calendar_type = 'active_client'
WHERE id = 4529;

-- Verify
SELECT id, calendar_type, meeting_date, meeting_time, status
FROM public.meetings
WHERE id = 4529;
