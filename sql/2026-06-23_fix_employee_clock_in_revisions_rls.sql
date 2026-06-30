-- Fix RLS on employee_clock_in_revisions: match users via auth_id (not users.id).
-- Without this fix, revision snapshots insert but approvers cannot read them.

DROP POLICY IF EXISTS "Superusers can read clock-in revisions" ON public.employee_clock_in_revisions;
CREATE POLICY "Superusers can read clock-in revisions"
ON public.employee_clock_in_revisions FOR SELECT
TO authenticated
USING (
    EXISTS (
        SELECT 1 FROM public.users u
        WHERE u.auth_id = auth.uid()
        AND (
            u.is_superuser IS TRUE
            OR u.is_superuser::text IN ('true', 't', '1')
            OR u.role = 'admin'
            OR u.is_staff IS TRUE
        )
    )
);

DROP POLICY IF EXISTS "Employees can read own clock-in revisions" ON public.employee_clock_in_revisions;
CREATE POLICY "Employees can read own clock-in revisions"
ON public.employee_clock_in_revisions FOR SELECT
TO authenticated
USING (
    EXISTS (
        SELECT 1 FROM public.users u
        WHERE u.auth_id = auth.uid()
        AND u.employee_id = employee_clock_in_revisions.employee_id
    )
);
