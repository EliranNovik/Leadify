-- Allow HR/superusers to submit and cancel working-hours submissions for any employee.
-- Employees keep insert/delete for their own rows.
-- Fixes: new row violates row-level security policy for table "employee_working_hours_submissions"
-- when submitting from HR Management on behalf of another employee.

DROP POLICY IF EXISTS "Employees can submit own working hours once per month"
    ON public.employee_working_hours_submissions;
CREATE POLICY "Employees can submit own working hours once per month"
ON public.employee_working_hours_submissions FOR INSERT
TO authenticated
WITH CHECK (
    auth.uid() = user_id
    AND EXISTS (
        SELECT 1 FROM public.users u
        WHERE u.auth_id = auth.uid()
          AND u.employee_id = employee_working_hours_submissions.employee_id
    )
);

DROP POLICY IF EXISTS "Superusers can submit working hours for any employee"
    ON public.employee_working_hours_submissions;
CREATE POLICY "Superusers can submit working hours for any employee"
ON public.employee_working_hours_submissions FOR INSERT
TO authenticated
WITH CHECK (
    auth.uid() = user_id
    AND EXISTS (
        SELECT 1 FROM public.users u
        WHERE u.auth_id = auth.uid()
          AND (
              u.is_superuser IS TRUE
              OR u.is_superuser::text IN ('true', 't', '1')
          )
    )
);

DROP POLICY IF EXISTS "Employees can cancel own working hours submissions"
    ON public.employee_working_hours_submissions;
CREATE POLICY "Employees can cancel own working hours submissions"
ON public.employee_working_hours_submissions FOR DELETE
TO authenticated
USING (
    EXISTS (
        SELECT 1 FROM public.users u
        WHERE u.auth_id = auth.uid()
          AND u.employee_id = employee_working_hours_submissions.employee_id
    )
);

DROP POLICY IF EXISTS "Superusers can cancel any working hours submissions"
    ON public.employee_working_hours_submissions;
CREATE POLICY "Superusers can cancel any working hours submissions"
ON public.employee_working_hours_submissions FOR DELETE
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

-- Ensure authenticated role can insert/delete (RLS still applies).
GRANT SELECT, INSERT, DELETE ON public.employee_working_hours_submissions TO authenticated;
