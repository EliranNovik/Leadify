-- Days HR marked as official holidays for every employee.
-- Automatic base hours are not added on these dates. Real clock-ins stay.
-- Run in the Supabase SQL editor.

CREATE TABLE IF NOT EXISTS public.company_official_holidays (
  work_date date PRIMARY KEY,
  name text NOT NULL DEFAULT 'Official holiday',
  created_at timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.company_official_holidays IS
  'Company-wide official holidays. They replace automatic base hours and are not required workdays.';

ALTER TABLE public.company_official_holidays ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS company_official_holidays_select ON public.company_official_holidays;
CREATE POLICY company_official_holidays_select
ON public.company_official_holidays
FOR SELECT
TO authenticated
USING (true);

DROP POLICY IF EXISTS company_official_holidays_insert ON public.company_official_holidays;
CREATE POLICY company_official_holidays_insert
ON public.company_official_holidays
FOR INSERT
TO authenticated
WITH CHECK (
  EXISTS (
    SELECT 1 FROM public.users u
    WHERE u.auth_id = auth.uid()
      AND (
        u.is_superuser IS TRUE
        OR u.is_superuser::text IN ('true', 't', '1')
      )
  )
);

DROP POLICY IF EXISTS company_official_holidays_delete ON public.company_official_holidays;
CREATE POLICY company_official_holidays_delete
ON public.company_official_holidays
FOR DELETE
TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.users u
    WHERE u.auth_id = auth.uid()
      AND (
        u.is_superuser IS TRUE
        OR u.is_superuser::text IN ('true', 't', '1')
      )
  )
);

GRANT SELECT, INSERT, DELETE ON public.company_official_holidays TO authenticated;
