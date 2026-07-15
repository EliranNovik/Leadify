-- Sick / vacation / general leave approval workflow (parity with employee_clock_in).
-- Run in Supabase SQL editor after create_employee_unavailability_reasons.sql

ALTER TABLE public.employee_unavailability_reasons
  ADD COLUMN IF NOT EXISTS approved boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS declined boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS approved_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS approved_at timestamp with time zone,
  ADD COLUMN IF NOT EXISTS decline_note text;

COMMENT ON COLUMN public.employee_unavailability_reasons.approved IS
  'True when leave has been approved by management (existing rows backfilled).';
COMMENT ON COLUMN public.employee_unavailability_reasons.declined IS
  'True when management declined the leave request.';
COMMENT ON COLUMN public.employee_unavailability_reasons.approved_by IS
  'Auth user id of the person who approved or declined.';
COMMENT ON COLUMN public.employee_unavailability_reasons.approved_at IS
  'Timestamp when approved or declined.';
COMMENT ON COLUMN public.employee_unavailability_reasons.decline_note IS
  'Optional note when the leave request was declined.';

-- Historical leave already in effect stays counted.
UPDATE public.employee_unavailability_reasons
SET approved = true
WHERE approved IS NOT TRUE
  AND declined IS NOT TRUE;

CREATE INDEX IF NOT EXISTS idx_employee_unavailability_reasons_pending
  ON public.employee_unavailability_reasons (employee_id, start_date DESC)
  WHERE approved = false AND declined = false;

DROP POLICY IF EXISTS "Admins can update unavailability approval" ON public.employee_unavailability_reasons;
CREATE POLICY "Admins can update unavailability approval"
ON public.employee_unavailability_reasons FOR UPDATE
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
)
WITH CHECK (
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
