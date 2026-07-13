-- Add "Other work" percent to daily lead allocations (non-lead time bucket).
-- Safe to run if column already exists.

ALTER TABLE public.employee_daily_lead_allocations
    ADD COLUMN IF NOT EXISTS other_work_percent numeric(5, 2) NOT NULL DEFAULT 0
        CHECK (other_work_percent >= 0 AND other_work_percent <= 100);

COMMENT ON COLUMN public.employee_daily_lead_allocations.other_work_percent IS
    'Share of the work day not attributed to specific leads (admin, meetings, etc.). Leads + other_work = 100%.';
