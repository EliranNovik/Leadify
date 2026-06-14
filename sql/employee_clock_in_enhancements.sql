-- Enhance employee_clock_in: clock-out location + superuser read access for Working Hours tab.
-- Run after sql/create_employee_clock_in_table.sql if that migration was already applied.

-- Clock-out location (clock-in location columns already exist)
ALTER TABLE public.employee_clock_in
  ADD COLUMN IF NOT EXISTS clock_out_location_latitude numeric(10, 8),
  ADD COLUMN IF NOT EXISTS clock_out_location_longitude numeric(11, 8),
  ADD COLUMN IF NOT EXISTS clock_out_location_address text,
  ADD COLUMN IF NOT EXISTS clock_out_location_city text,
  ADD COLUMN IF NOT EXISTS clock_out_location_country text,
  ADD COLUMN IF NOT EXISTS clock_out_location_source text;

COMMENT ON COLUMN public.employee_clock_in.clock_out_location_address IS 'Human-readable address when employee clocked out';

-- Superusers can view all employees'' clock-in records (Working Hours tab — per worker)
DROP POLICY IF EXISTS "Superusers can view all clock-in records" ON public.employee_clock_in;
CREATE POLICY "Superusers can view all clock-in records"
ON public.employee_clock_in FOR SELECT
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
