-- Employee WhatsApp number for internal nine-hour overtime alerts + send dedupe.

ALTER TABLE public.tenants_employee
  ADD COLUMN IF NOT EXISTS employee_mobile VARCHAR(50);

COMMENT ON COLUMN public.tenants_employee.employee_mobile IS
  'Mobile number for internal employee WhatsApp notifications (e.g. nine-hour overtime popup alert).';

CREATE TABLE IF NOT EXISTS public.employee_clock_in_nine_hour_whatsapp_sent (
    employee_id bigint NOT NULL,
    work_date date NOT NULL,
    sent_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT employee_clock_in_nine_hour_whatsapp_sent_pkey PRIMARY KEY (employee_id, work_date),
    CONSTRAINT employee_clock_in_nine_hour_whatsapp_sent_employee_id_fkey
        FOREIGN KEY (employee_id) REFERENCES public.tenants_employee(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_employee_clock_in_nine_hour_whatsapp_sent_work_date
    ON public.employee_clock_in_nine_hour_whatsapp_sent(work_date);

COMMENT ON TABLE public.employee_clock_in_nine_hour_whatsapp_sent IS
    'One WhatsApp template alert per employee per day when the nine-hour overtime popup is triggered.';

ALTER TABLE public.employee_clock_in_nine_hour_whatsapp_sent ENABLE ROW LEVEL SECURITY;
