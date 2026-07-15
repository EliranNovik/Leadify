-- Optional: persist employee_id on kiosk flash for welcome meetings lookup.
ALTER TABLE public.clock_in_kiosk_flash
  ADD COLUMN IF NOT EXISTS employee_id INTEGER;

COMMENT ON COLUMN public.clock_in_kiosk_flash.employee_id IS
  'Employee who clocked in; used to load today meetings on the kiosk welcome modal.';
