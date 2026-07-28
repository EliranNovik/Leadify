-- Lookup: categories for per-lead case expenses (Finances → Expenses).

CREATE TABLE IF NOT EXISTS public.lead_expense_types (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code text NOT NULL UNIQUE,
  label text NOT NULL,
  sort_order integer NOT NULL DEFAULT 0,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.lead_expense_types IS
  'Lookup categories for lead_expenses (Government fees, Translation, Courier, …).';
COMMENT ON COLUMN public.lead_expense_types.code IS
  'Stable machine key, e.g. government_and_court_fees.';

INSERT INTO public.lead_expense_types (code, label, sort_order)
VALUES
  ('government_and_court_fees', 'Government and court fees', 10),
  ('translation_and_notary', 'Translation and notary', 20),
  ('documents_and_certificates', 'Documents and certificates', 30),
  ('courier_and_delivery', 'Courier and delivery', 40),
  ('external_professionals', 'External professionals', 50),
  ('travel_and_accommodation', 'Travel and accommodation', 60),
  ('printing_and_administration', 'Printing and administration', 70),
  ('banking_and_payment_fees', 'Banking and payment fees', 80),
  ('refunds', 'Refunds', 90),
  ('other_client_expenses', 'Other client expenses', 100)
ON CONFLICT (code) DO UPDATE SET
  label = EXCLUDED.label,
  sort_order = EXCLUDED.sort_order,
  is_active = true;

CREATE INDEX IF NOT EXISTS idx_lead_expense_types_active_sort
  ON public.lead_expense_types (is_active, sort_order);

ALTER TABLE public.lead_expense_types ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Authenticated can view lead expense types"
  ON public.lead_expense_types;
CREATE POLICY "Authenticated can view lead expense types"
ON public.lead_expense_types FOR SELECT
TO authenticated
USING (true);

DROP POLICY IF EXISTS "Authenticated can manage lead expense types"
  ON public.lead_expense_types;
CREATE POLICY "Authenticated can manage lead expense types"
ON public.lead_expense_types FOR ALL
TO authenticated
USING (true)
WITH CHECK (true);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.lead_expense_types TO authenticated;
