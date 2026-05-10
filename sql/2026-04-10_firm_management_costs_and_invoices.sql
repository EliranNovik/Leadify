-- =============================================================================
-- Firm management costs & invoices (many rows per firm; FK → firms.id)
-- Run in Supabase SQL after firms exist. Uses firms_touch_updated_at if present.
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.firm_management_costs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid (),
  firm_id uuid NOT NULL REFERENCES public.firms (id) ON DELETE CASCADE,
  billing_month date NOT NULL,
  amount numeric(14, 2) NOT NULL,
  currency text NOT NULL DEFAULT 'ILS',
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_firm_management_costs_firm ON public.firm_management_costs (firm_id);
CREATE INDEX IF NOT EXISTS idx_firm_management_costs_month ON public.firm_management_costs (billing_month);

COMMENT ON TABLE public.firm_management_costs IS 'Recurring or one-off management cost lines per firm (e.g. monthly).';
COMMENT ON COLUMN public.firm_management_costs.billing_month IS 'Anchor month (typically first day of month).';

CREATE TABLE IF NOT EXISTS public.firm_invoices (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid (),
  firm_id uuid NOT NULL REFERENCES public.firms (id) ON DELETE CASCADE,
  invoice_month date NOT NULL,
  amount numeric(14, 2),
  currency text NOT NULL DEFAULT 'ILS',
  notes text,
  storage_path text,
  file_name text,
  mime_type text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_firm_invoices_firm ON public.firm_invoices (firm_id);
CREATE INDEX IF NOT EXISTS idx_firm_invoices_month ON public.firm_invoices (invoice_month);

COMMENT ON TABLE public.firm_invoices IS 'Invoice records per firm; optional file in Storage (bucket firm-invoice-documents).';
COMMENT ON COLUMN public.firm_invoices.storage_path IS 'Object path inside firm-invoice-documents bucket.';

DROP TRIGGER IF EXISTS tr_firm_management_costs_updated_at ON public.firm_management_costs;
CREATE TRIGGER tr_firm_management_costs_updated_at
  BEFORE UPDATE ON public.firm_management_costs
  FOR EACH ROW
  EXECUTE FUNCTION public.firms_touch_updated_at ();

DROP TRIGGER IF EXISTS tr_firm_invoices_updated_at ON public.firm_invoices;
CREATE TRIGGER tr_firm_invoices_updated_at
  BEFORE UPDATE ON public.firm_invoices
  FOR EACH ROW
  EXECUTE FUNCTION public.firms_touch_updated_at ();

ALTER TABLE public.firm_management_costs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.firm_invoices ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "firm_management_costs_authenticated_all" ON public.firm_management_costs;
DROP POLICY IF EXISTS "firm_invoices_authenticated_all" ON public.firm_invoices;

CREATE POLICY "firm_management_costs_authenticated_all" ON public.firm_management_costs
  FOR ALL TO authenticated
  USING (true)
  WITH CHECK (true);

CREATE POLICY "firm_invoices_authenticated_all" ON public.firm_invoices
  FOR ALL TO authenticated
  USING (true)
  WITH CHECK (true);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.firm_management_costs TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.firm_invoices TO authenticated;
