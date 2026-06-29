-- Snapshot billing contact on payment_links at link creation (staff-authenticated).
-- Used for Payper + confirmation email when live contact lookup fails or plan_contact_id is stale.

ALTER TABLE public.payment_links
  ADD COLUMN IF NOT EXISTS billing_contact_email TEXT,
  ADD COLUMN IF NOT EXISTS billing_contact_name TEXT;

COMMENT ON COLUMN public.payment_links.billing_contact_email IS
  'Billing email copied from plan contact when payment link was created (or backfilled)';
COMMENT ON COLUMN public.payment_links.billing_contact_name IS
  'Billing contact name copied from plan contact when payment link was created (or backfilled)';

-- Backfill from plan_contact_id → leads_contact
UPDATE public.payment_links pl
SET
  billing_contact_email = lc.email,
  billing_contact_name = COALESCE(pl.billing_contact_name, lc.name)
FROM public.leads_contact lc
WHERE pl.plan_contact_id = lc.id
  AND pl.billing_contact_email IS NULL
  AND lc.email IS NOT NULL
  AND TRIM(lc.email) <> '';
