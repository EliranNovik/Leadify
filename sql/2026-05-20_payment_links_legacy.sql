-- Legacy payment links support (run in Supabase SQL editor).
-- 1) legacy_id → leads_lead.id (UI uses legacy_114658, not UUID)
-- 2) payment_plan_id may reference finances_paymentplanrow.id (not payment_plans)

ALTER TABLE payment_links
  ADD COLUMN IF NOT EXISTS legacy_id BIGINT;

ALTER TABLE payment_links DROP CONSTRAINT IF EXISTS payment_links_legacy_id_fkey;
ALTER TABLE payment_links
  ADD CONSTRAINT payment_links_legacy_id_fkey
  FOREIGN KEY (legacy_id) REFERENCES leads_lead (id) ON DELETE CASCADE;

CREATE INDEX IF NOT EXISTS idx_payment_links_legacy_id
  ON public.payment_links (legacy_id)
  WHERE legacy_id IS NOT NULL;

ALTER TABLE payment_links
  ADD COLUMN IF NOT EXISTS is_legacy_payment_plan BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE payment_links DROP CONSTRAINT IF EXISTS payment_links_payment_plan_id_fkey;

-- Legacy finances_paymentplanrow ids can be timestamp-sized (e.g. Date.now()); integer overflows.
ALTER TABLE payment_links
  ALTER COLUMN payment_plan_id TYPE BIGINT USING payment_plan_id::bigint;

COMMENT ON COLUMN payment_links.legacy_id IS 'Legacy lead id (leads_lead.id); use when client_id is null';
COMMENT ON COLUMN payment_links.is_legacy_payment_plan IS
  'When true, payment_plan_id is finances_paymentplanrow.id';

-- RLS: see sql/2026-05-20_payment_links_rls.sql (required for legacy link generation).
