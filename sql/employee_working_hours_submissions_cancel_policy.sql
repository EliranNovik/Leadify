-- Allow employees to cancel (delete) their own monthly working-hours submission.

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
