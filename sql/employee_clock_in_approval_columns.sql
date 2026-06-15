-- Manual clock-in/out approval workflow.
-- Run after sql/employee_clock_in_manually_column.sql

ALTER TABLE public.employee_clock_in
  ADD COLUMN IF NOT EXISTS approved boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS declined boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS approved_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS approved_at timestamp with time zone;

COMMENT ON COLUMN public.employee_clock_in.approved IS
  'True when a manual entry has been approved by an admin (automatic entries are always approved).';
COMMENT ON COLUMN public.employee_clock_in.declined IS
  'True when an admin declined a manual clock-in/out entry.';
COMMENT ON COLUMN public.employee_clock_in.approved_by IS
  'Auth user id of the admin who approved or declined the entry.';
COMMENT ON COLUMN public.employee_clock_in.approved_at IS
  'Timestamp when the entry was approved or declined.';

-- Automatic (live) clock-ins are approved; manual entries await review.
UPDATE public.employee_clock_in
SET approved = true
WHERE manually IS NOT TRUE;

CREATE INDEX IF NOT EXISTS idx_employee_clock_in_manual_pending
  ON public.employee_clock_in (employee_id, clock_in_time DESC)
  WHERE manually = true AND approved = false AND declined = false;

-- Admins / staff can update approval fields on any employee record.
DROP POLICY IF EXISTS "Admins can update clock-in approval" ON public.employee_clock_in;
CREATE POLICY "Admins can update clock-in approval"
ON public.employee_clock_in FOR UPDATE
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
