-- WhatsApp Yes/No approval for overtime clock-ins, sent to Michael Decker.
-- The template id lives in CLOCK_IN_OVERTIME_APPROVAL_TEMPLATE_ID (placeholders: employee, description).

CREATE TABLE IF NOT EXISTS public.employee_clock_in_overtime_requests (
  id bigserial PRIMARY KEY,
  employee_id integer NOT NULL,
  clock_in_ids integer[] NOT NULL,
  employee_name text,
  reason text,
  description text,
  whatsapp_message_id text,
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'approved', 'declined')),
  created_at timestamptz NOT NULL DEFAULT now(),
  resolved_at timestamptz
);

CREATE INDEX IF NOT EXISTS employee_clock_in_overtime_requests_wamid_idx
  ON public.employee_clock_in_overtime_requests (whatsapp_message_id);

CREATE INDEX IF NOT EXISTS employee_clock_in_overtime_requests_employee_idx
  ON public.employee_clock_in_overtime_requests (employee_id, created_at DESC);

ALTER TABLE public.employee_clock_in_overtime_requests REPLICA IDENTITY FULL;

ALTER TABLE public.employee_clock_in_overtime_requests ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS employee_clock_in_overtime_requests_select_own
  ON public.employee_clock_in_overtime_requests;

CREATE POLICY employee_clock_in_overtime_requests_select_own
  ON public.employee_clock_in_overtime_requests
  FOR SELECT
  TO authenticated
  USING (
    employee_id = (
      SELECT u.employee_id
      FROM public.users u
      WHERE u.auth_id = auth.uid()
      LIMIT 1
    )
  );

GRANT SELECT ON public.employee_clock_in_overtime_requests TO authenticated;

DO $$
BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE public.employee_clock_in_overtime_requests;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
