-- Days where automatic base hours were removed and must not be filled again.
-- Run in the Supabase SQL editor.

CREATE TABLE IF NOT EXISTS public.employee_auto_fill_exclusions (
  id bigserial PRIMARY KEY,
  employee_id integer NOT NULL,
  work_date date NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (employee_id, work_date)
);

CREATE INDEX IF NOT EXISTS employee_auto_fill_exclusions_employee_date_idx
  ON public.employee_auto_fill_exclusions (employee_id, work_date);

COMMENT ON TABLE public.employee_auto_fill_exclusions IS
  'Working days whose automatic base hours were deleted and must stay empty.';

ALTER TABLE public.employee_auto_fill_exclusions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS employee_auto_fill_exclusions_select ON public.employee_auto_fill_exclusions;
CREATE POLICY employee_auto_fill_exclusions_select
ON public.employee_auto_fill_exclusions
FOR SELECT
TO authenticated
USING (
  employee_id = (
    SELECT u.employee_id FROM public.users u WHERE u.auth_id = auth.uid() LIMIT 1
  )
  OR EXISTS (
    SELECT 1 FROM public.users u
    WHERE u.auth_id = auth.uid()
      AND (
        u.is_superuser IS TRUE
        OR u.is_superuser::text IN ('true', 't', '1')
      )
  )
);

DROP POLICY IF EXISTS employee_auto_fill_exclusions_insert ON public.employee_auto_fill_exclusions;
CREATE POLICY employee_auto_fill_exclusions_insert
ON public.employee_auto_fill_exclusions
FOR INSERT
TO authenticated
WITH CHECK (
  employee_id = (
    SELECT u.employee_id FROM public.users u WHERE u.auth_id = auth.uid() LIMIT 1
  )
  OR EXISTS (
    SELECT 1 FROM public.users u
    WHERE u.auth_id = auth.uid()
      AND (
        u.is_superuser IS TRUE
        OR u.is_superuser::text IN ('true', 't', '1')
      )
  )
);

DROP POLICY IF EXISTS employee_auto_fill_exclusions_delete ON public.employee_auto_fill_exclusions;
CREATE POLICY employee_auto_fill_exclusions_delete
ON public.employee_auto_fill_exclusions
FOR DELETE
TO authenticated
USING (
  employee_id = (
    SELECT u.employee_id FROM public.users u WHERE u.auth_id = auth.uid() LIMIT 1
  )
  OR EXISTS (
    SELECT 1 FROM public.users u
    WHERE u.auth_id = auth.uid()
      AND (
        u.is_superuser IS TRUE
        OR u.is_superuser::text IN ('true', 't', '1')
      )
  )
);

GRANT SELECT, INSERT, DELETE ON public.employee_auto_fill_exclusions TO authenticated;
GRANT USAGE, SELECT ON SEQUENCE public.employee_auto_fill_exclusions_id_seq TO authenticated;
