-- Client heartbeat while the app is open and user is clocked in.
-- Server auto clock-out skips active users (recent heartbeat) so the in-browser overtime UI can run.
CREATE TABLE IF NOT EXISTS public.employee_clock_in_presence (
    employee_id bigint NOT NULL,
    last_seen_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT employee_clock_in_presence_pkey PRIMARY KEY (employee_id),
    CONSTRAINT employee_clock_in_presence_employee_id_fkey
        FOREIGN KEY (employee_id) REFERENCES public.tenants_employee(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_employee_clock_in_presence_last_seen_at
    ON public.employee_clock_in_presence(last_seen_at DESC);

COMMENT ON TABLE public.employee_clock_in_presence IS
    'Last client activity ping while clocked in; used to avoid server auto clock-out for active browser sessions';

ALTER TABLE public.employee_clock_in_presence ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Employees can upsert own clock-in presence"
ON public.employee_clock_in_presence;

CREATE POLICY "Employees can upsert own clock-in presence"
ON public.employee_clock_in_presence
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
