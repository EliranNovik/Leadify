-- Contact id on payment_links (from payment plan row) + backfill missing lead refs.
-- payment_links.client_id = new lead UUID; legacy_id = leads_lead.id; plan_contact_id = contact id.

ALTER TABLE public.payment_links
  ADD COLUMN IF NOT EXISTS plan_contact_id BIGINT;

CREATE INDEX IF NOT EXISTS idx_payment_links_plan_contact_id
  ON public.payment_links (plan_contact_id)
  WHERE plan_contact_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_payment_links_payment_plan_id_status
  ON public.payment_links (payment_plan_id, status)
  WHERE payment_plan_id IS NOT NULL;

COMMENT ON COLUMN public.payment_links.plan_contact_id IS
  'Contact id (payment_plans.client_id / finances_paymentplanrow.client_id) for per-contact payment history';

-- Backfill plan_contact_id from new payment plans
UPDATE public.payment_links pl
SET plan_contact_id = pp.client_id
FROM public.payment_plans pp
WHERE pl.payment_plan_id = pp.id
  AND pl.plan_contact_id IS NULL
  AND pp.client_id IS NOT NULL;

-- Backfill plan_contact_id from legacy payment plan rows
UPDATE public.payment_links pl
SET plan_contact_id = fpr.client_id
FROM public.finances_paymentplanrow fpr
WHERE pl.payment_plan_id = fpr.id
  AND pl.is_legacy_payment_plan = true
  AND pl.plan_contact_id IS NULL
  AND fpr.client_id IS NOT NULL;

-- Backfill missing client_id (new leads) from payment_plans.lead_id
UPDATE public.payment_links pl
SET client_id = pp.lead_id
FROM public.payment_plans pp
WHERE pl.payment_plan_id = pp.id
  AND pl.client_id IS NULL
  AND pl.legacy_id IS NULL
  AND (pl.is_legacy_payment_plan IS NULL OR pl.is_legacy_payment_plan = false)
  AND pp.lead_id IS NOT NULL;

-- Backfill missing legacy_id from finances_paymentplanrow.lead_id
UPDATE public.payment_links pl
SET legacy_id = fpr.lead_id::bigint,
    is_legacy_payment_plan = true
FROM public.finances_paymentplanrow fpr
WHERE pl.payment_plan_id = fpr.id
  AND pl.legacy_id IS NULL
  AND pl.client_id IS NULL
  AND fpr.lead_id IS NOT NULL
  AND fpr.lead_id ~ '^\d+$';
