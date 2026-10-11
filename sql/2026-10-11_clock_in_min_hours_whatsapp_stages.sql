-- Two WhatsApp sends per employee per day instead of one.
--
-- The clock-in policy moved off a fixed nine hours and onto each employee's own `min_hours`: a
-- reminder one hour before it, then a notice when the auto clock-out fires at it. Both are deduped
-- through this table, so the stage has to be part of the key or the second send of the day is
-- swallowed as a repeat of the first.
--
-- Existing rows are the old single nine-hour alert, which was a reminder, so they backfill as one.

ALTER TABLE public.employee_clock_in_nine_hour_whatsapp_sent
    ADD COLUMN IF NOT EXISTS stage text NOT NULL DEFAULT 'reminder';

ALTER TABLE public.employee_clock_in_nine_hour_whatsapp_sent
    DROP CONSTRAINT IF EXISTS employee_clock_in_nine_hour_whatsapp_sent_stage_check;

ALTER TABLE public.employee_clock_in_nine_hour_whatsapp_sent
    ADD CONSTRAINT employee_clock_in_nine_hour_whatsapp_sent_stage_check
        CHECK (stage IN ('reminder', 'clock_out'));

-- Nothing references this primary key, so it can be swapped in place.
ALTER TABLE public.employee_clock_in_nine_hour_whatsapp_sent
    DROP CONSTRAINT IF EXISTS employee_clock_in_nine_hour_whatsapp_sent_pkey;

ALTER TABLE public.employee_clock_in_nine_hour_whatsapp_sent
    ADD CONSTRAINT employee_clock_in_nine_hour_whatsapp_sent_pkey
        PRIMARY KEY (employee_id, work_date, stage);

COMMENT ON TABLE public.employee_clock_in_nine_hour_whatsapp_sent IS
    'One WhatsApp alert per employee per day per stage: a reminder an hour before the employee''s '
    'min_hours, and a notice when the auto clock-out fires at min_hours.';

COMMENT ON COLUMN public.employee_clock_in_nine_hour_whatsapp_sent.stage IS
    'reminder = sent an hour before min_hours; clock_out = sent when the auto clock-out fired.';
