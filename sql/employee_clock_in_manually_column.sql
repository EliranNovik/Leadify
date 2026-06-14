-- Manual clock-in/out entries (Working Hours tab) + superuser write access.
-- Run after sql/create_employee_clock_in_table.sql

ALTER TABLE public.employee_clock_in
  ADD COLUMN IF NOT EXISTS manually boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.employee_clock_in.manually IS
  'True when the record was added manually (not via live clock-in/out).';

-- Superusers can insert clock-in records for any employee (manual corrections)
DROP POLICY IF EXISTS "Superusers can insert clock-in records" ON public.employee_clock_in;
CREATE POLICY "Superusers can insert clock-in records"
ON public.employee_clock_in FOR INSERT
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

-- Superusers can update any clock-in record (e.g. fix manual entries)
DROP POLICY IF EXISTS "Superusers can update clock-in records" ON public.employee_clock_in;
CREATE POLICY "Superusers can update clock-in records"
ON public.employee_clock_in FOR UPDATE
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
)
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

-- Users can delete their own clock-in records
DROP POLICY IF EXISTS "Users can delete their own clock-in records" ON public.employee_clock_in;
CREATE POLICY "Users can delete their own clock-in records"
ON public.employee_clock_in FOR DELETE
TO authenticated
USING (auth.uid() = user_id);

-- Superusers can delete any clock-in record
DROP POLICY IF EXISTS "Superusers can delete clock-in records" ON public.employee_clock_in;
CREATE POLICY "Superusers can delete clock-in records"
ON public.employee_clock_in FOR DELETE
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
