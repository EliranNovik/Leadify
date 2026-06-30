-- Optional admin message when declining a manual clock-in entry (shown to the employee).
-- Run after sql/employee_clock_in_approval_columns.sql

ALTER TABLE public.employee_clock_in
  ADD COLUMN IF NOT EXISTS decline_note text;

COMMENT ON COLUMN public.employee_clock_in.decline_note IS
  'Optional message from an admin when declining a manual clock-in/out entry; visible to the employee on their working hours row.';
