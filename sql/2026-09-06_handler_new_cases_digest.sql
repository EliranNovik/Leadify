-- Daily handler digest: remember which New / Re-assigned cases were already emailed
-- so the 10:00 Asia/Jerusalem job does not repeat the same assignment.

CREATE TABLE IF NOT EXISTS public.handler_new_cases_digest_sent (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id bigint NOT NULL,
  lead_type text NOT NULL CHECK (lead_type IN ('new', 'legacy')),
  lead_id text NOT NULL,
  assignment_kind text NOT NULL CHECK (assignment_kind IN ('new', 'reassigned')),
  assignment_date date NOT NULL,
  digest_date date NOT NULL,
  sent_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS handler_new_cases_digest_sent_uniq
  ON public.handler_new_cases_digest_sent (employee_id, lead_type, lead_id, assignment_kind, assignment_date);

CREATE INDEX IF NOT EXISTS handler_new_cases_digest_sent_employee_date_idx
  ON public.handler_new_cases_digest_sent (employee_id, digest_date DESC);

ALTER TABLE public.handler_new_cases_digest_sent ENABLE ROW LEVEL SECURITY;
