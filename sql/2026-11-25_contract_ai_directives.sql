-- Editable contract AI policies, rules, and behavior.
-- The contract checker and the contract AI read the active rows.
-- Run in the Supabase SQL editor. Safe to run more than once.

CREATE TABLE IF NOT EXISTS public.contract_ai_directives (
  id text PRIMARY KEY,
  category text NOT NULL CHECK (category IN ('policy', 'rule', 'behavior')),
  title text NOT NULL,
  line text,
  body text NOT NULL,
  sort_order integer NOT NULL DEFAULT 0,
  is_active boolean NOT NULL DEFAULT true,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.contract_ai_directives IS
  'Admin-edited text the contract AI must follow. policy rows are checked in fee agreements. rule and behavior rows guide how the AI writes.';

ALTER TABLE public.contract_ai_directives ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS contract_ai_directives_select ON public.contract_ai_directives;
CREATE POLICY contract_ai_directives_select
ON public.contract_ai_directives
FOR SELECT
TO authenticated
USING (true);

DROP POLICY IF EXISTS contract_ai_directives_insert ON public.contract_ai_directives;
CREATE POLICY contract_ai_directives_insert
ON public.contract_ai_directives
FOR INSERT
TO authenticated
WITH CHECK (
  EXISTS (
    SELECT 1 FROM public.users u
    WHERE u.auth_id = auth.uid()
      AND (u.is_superuser IS TRUE OR u.is_superuser::text IN ('true', 't', '1'))
  )
);

DROP POLICY IF EXISTS contract_ai_directives_update ON public.contract_ai_directives;
CREATE POLICY contract_ai_directives_update
ON public.contract_ai_directives
FOR UPDATE
TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.users u
    WHERE u.auth_id = auth.uid()
      AND (u.is_superuser IS TRUE OR u.is_superuser::text IN ('true', 't', '1'))
  )
)
WITH CHECK (
  EXISTS (
    SELECT 1 FROM public.users u
    WHERE u.auth_id = auth.uid()
      AND (u.is_superuser IS TRUE OR u.is_superuser::text IN ('true', 't', '1'))
  )
);

DROP POLICY IF EXISTS contract_ai_directives_delete ON public.contract_ai_directives;
CREATE POLICY contract_ai_directives_delete
ON public.contract_ai_directives
FOR DELETE
TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.users u
    WHERE u.auth_id = auth.uid()
      AND (u.is_superuser IS TRUE OR u.is_superuser::text IN ('true', 't', '1'))
  )
);

INSERT INTO public.contract_ai_directives (id, category, title, line, body, sort_order)
VALUES
  (
    'no_refunds',
    'policy',
    'No refunds',
    'Fees are not refunded, subject to applicable law.',
    'No refunds will be issued under any circumstances, subject to applicable law. The client enters the engagement understanding and accepting this.',
    1
  ),
  (
    'time_and_expertise',
    'policy',
    'Time and expertise',
    'The client pays for time and expertise, not for a specific outcome.',
    'The firm sells its time and expertise. Legal fees are paid for these professional services, not for letters, court judgments, visas, or any other specific outcome.',
    2
  ),
  (
    'fixed_fee_viability',
    'policy',
    'Fixed fees and economic viability',
    'The fixed fee is an estimate of hours, and the firm cannot work at a loss.',
    'The fixed fee is the firm’s estimate of the hours required, based on professional experience. The client is still paying for time and expertise. The firm must remain economically viable and cannot operate at a loss. If the hours invested make the effective hourly rate unsustainable, the parties will discuss it.',
    3
  ),
  (
    'budget_reliance',
    'policy',
    'Financial and budgetary reliance',
    'After signing and payment, the firm relies on the full agreed fee.',
    'The firm bases its budget on the agreed legal fees. After the agreement is signed and payment is made, the firm relies on the full agreed amount and plans its expenses accordingly. By signing, the client confirms they understand and accept this.',
    4
  ),
  (
    'clause_formatting',
    'behavior',
    'Numbered clauses',
    NULL,
    'When adding clauses, continue the contract numbering. Each new clause is its own paragraph with a blank line around it. Bold the number and a short title, then write the sentence. Never place two new clauses in one paragraph.',
    1
  ),
  (
    'do_not_weaken',
    'rule',
    'Do not weaken existing terms',
    NULL,
    'Do not remove or weaken existing contract terms. A heading alone does not satisfy a policy. Equivalent wording in the contract language counts.',
    1
  )
ON CONFLICT (id) DO NOTHING;
