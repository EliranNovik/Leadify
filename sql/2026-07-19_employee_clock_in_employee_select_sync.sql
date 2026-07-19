-- Keep My Profile Working Hours in sync with HR Management.
--
-- Problem:
--   Employee SELECT on employee_clock_in was only `auth.uid() = user_id`.
--   HR manual entries often stored the HR user's auth uid as user_id while
--   employee_id pointed at the worker. HR (superuser) saw those rows;
--   the employee did not — so Profile could show 1 approved session while
--   HR showed 2 sessions with Declined for the same day.
--
-- Fix:
--   1) Employees can SELECT any row for their own employee_id.
--   2) Backfill user_id to the employee's auth_id where it drifted.

DROP POLICY IF EXISTS "Users can view their own clock-in records"
  ON public.employee_clock_in;

CREATE POLICY "Users can view their own clock-in records"
ON public.employee_clock_in FOR SELECT
TO authenticated
USING (
  auth.uid() = user_id
  OR EXISTS (
    SELECT 1
    FROM public.users u
    WHERE u.auth_id = auth.uid()
      AND u.employee_id = employee_clock_in.employee_id
  )
);

-- Point drifted manual/HR-authored rows at the employee account.
UPDATE public.employee_clock_in AS eci
SET user_id = u.auth_id
FROM public.users AS u
WHERE u.employee_id = eci.employee_id
  AND u.auth_id IS NOT NULL
  AND eci.user_id IS DISTINCT FROM u.auth_id;
