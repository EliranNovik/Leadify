-- Lead time reporting: per-employee opt-in + fill-day schedule
-- Default schedule: Sun–Thu (0–4), Fri/Sat off; reporting start remains 2026-08-06 in app code.

ALTER TABLE public.tenants_employee
  ADD COLUMN IF NOT EXISTS lead_time_reporting_enabled boolean NOT NULL DEFAULT false;

ALTER TABLE public.tenants_employee
  ADD COLUMN IF NOT EXISTS lead_time_reporting_weekdays smallint[] NOT NULL DEFAULT ARRAY[0, 1, 2, 3, 4]::smallint[];

ALTER TABLE public.tenants_employee
  ADD COLUMN IF NOT EXISTS lead_time_reporting_excluded_dates date[] NOT NULL DEFAULT ARRAY[]::date[];

COMMENT ON COLUMN public.tenants_employee.lead_time_reporting_enabled IS
  'When true, employee sees Lead time report in sidebar, missing-report badge, and fill reminders/modals.';

COMMENT ON COLUMN public.tenants_employee.lead_time_reporting_weekdays IS
  'Weekdays that require a lead allocation (0=Sunday … 6=Saturday). Default Sun–Thu.';

COMMENT ON COLUMN public.tenants_employee.lead_time_reporting_excluded_dates IS
  'Specific calendar dates that do not require a lead allocation, even if weekday is enabled.';

-- Preserve current behavior for handlers / department managers already using the feature.
UPDATE public.tenants_employee
SET lead_time_reporting_enabled = true
WHERE lead_time_reporting_enabled = false
  AND lower(trim(coalesce(bonuses_role, ''))) IN ('h', 'dm');
