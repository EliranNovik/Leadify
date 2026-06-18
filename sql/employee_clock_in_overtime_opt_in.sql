-- Tracks when an employee chose to continue working past 9 hours (client + server enforcement).
CREATE TABLE IF NOT EXISTS public.employee_clock_in_overtime_opt_in (
    employee_id bigint NOT NULL,
    work_date date NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT employee_clock_in_overtime_opt_in_pkey PRIMARY KEY (employee_id, work_date),
    CONSTRAINT employee_clock_in_overtime_opt_in_employee_id_fkey
        FOREIGN KEY (employee_id) REFERENCES public.tenants_employee(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_employee_clock_in_overtime_opt_in_work_date
    ON public.employee_clock_in_overtime_opt_in(work_date);

COMMENT ON TABLE public.employee_clock_in_overtime_opt_in IS
    'Per-day flag when employee explicitly continues working past the 9-hour limit';

ALTER TABLE public.employee_clock_in_overtime_opt_in ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Employees can manage own overtime opt-in"
ON public.employee_clock_in_overtime_opt_in;

CREATE POLICY "Employees can manage own overtime opt-in"
ON public.employee_clock_in_overtime_opt_in
FOR ALL
TO authenticated
USING (
    employee_id IN (
        SELECT u.employee_id
        FROM public.users u
        WHERE u.auth_id = auth.uid()
          AND u.employee_id IS NOT NULL
    )
)
WITH CHECK (
    employee_id IN (
        SELECT u.employee_id
        FROM public.users u
        WHERE u.auth_id = auth.uid()
          AND u.employee_id IS NOT NULL
    )
);
