-- Multiple payment plans per contact.
--
-- Both payment tables hold one row per installment, keyed to a lead and a contact. Until now every
-- row for a contact was treated as a single plan: the UI grouped by contact alone, and deleting a
-- "plan" deleted every row the contact had. `plan_number` separates those rows into plans, numbered
-- from 1 per (lead, contact).
--
-- NOT NULL DEFAULT 1 backfills every existing row as plan 1, so current plans keep working and no
-- data migration is needed. Postgres stores a constant default in the catalog rather than rewriting
-- the table, so this is cheap even on the larger legacy table.

ALTER TABLE public.payment_plans
  ADD COLUMN IF NOT EXISTS plan_number INTEGER NOT NULL DEFAULT 1;

ALTER TABLE public.finances_paymentplanrow
  ADD COLUMN IF NOT EXISTS plan_number INTEGER NOT NULL DEFAULT 1;

COMMENT ON COLUMN public.payment_plans.plan_number IS
  'Which payment plan this installment belongs to, numbered from 1 per (lead_id, contact). Lets one contact hold several independent plans.';
COMMENT ON COLUMN public.finances_paymentplanrow.plan_number IS
  'Which payment plan this installment belongs to, numbered from 1 per (lead_id, contact). Lets one contact hold several independent plans.';

-- Grouping key for the finances tab: every read is "rows for this lead, split by contact and plan".
CREATE INDEX IF NOT EXISTS idx_payment_plans_lead_contact_plan
  ON public.payment_plans (lead_id, client_id, plan_number);

CREATE INDEX IF NOT EXISTS idx_finances_ppr_lead_contact_plan
  ON public.finances_paymentplanrow (lead_id, client_id, plan_number);

-- No unique constraint on (lead_id, client_id, plan_number): a plan is many installment rows, so
-- duplicates across that triple are the normal case.

NOTIFY pgrst, 'reload schema';
