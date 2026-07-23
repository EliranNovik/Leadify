-- Allow calendar_type = 'recruitment' on meetings (ATS interview meetings).
-- Run in Supabase SQL editor if Phase 1 was already applied without this change.

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
