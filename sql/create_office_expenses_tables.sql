-- =============================================================================
-- Office expenses (Admin → All Expenses → Office Expenses)
--
-- Prerequisites:
--   - public.firms
--   - auth.users
--   - public.firms_touch_updated_at() (optional; for updated_at trigger)
--   - Storage buckets (reuse management-cost buckets; no new buckets required):
--       firm-invoice-documents              → office_expenses.invoice
--       firm-management-payment-confirmations → office_expenses.payment_confirmation
--       firm-management-tax-receipts        → office_expenses.tax_receipt
--
-- Suggested object path prefix in app code:
--   office-expenses/<office_expense_id>/<column>/<timestamp>_<filename>
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Lookup: office expense categories (Open AI, legal opinions, consultation, …)
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.office_expense_types (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code text NOT NULL UNIQUE,
  label text NOT NULL,
  sort_order integer NOT NULL DEFAULT 0,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.office_expense_types IS
  'Lookup categories for office_expenses lines (Admin → Office Expenses).';

COMMENT ON COLUMN public.office_expense_types.code IS
  'Stable machine key, e.g. open_ai_fee';

INSERT INTO public.office_expense_types (code, label, sort_order)
VALUES
  ('open_ai_fee', 'Open AI Fee', 10),
  ('legal_opinions', 'Legal Opinions', 20),
  ('consultation', 'Consultation', 30)
ON CONFLICT (code) DO UPDATE SET
  label = EXCLUDED.label,
  sort_order = EXCLUDED.sort_order,
  is_active = true;

-- -----------------------------------------------------------------------------
-- Main table: one row per office expense line
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.office_expenses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  firm_id uuid NOT NULL REFERENCES public.firms (id) ON DELETE RESTRICT,
  amount numeric(14, 2) NOT NULL,
  currency text NOT NULL DEFAULT 'ILS',
  expense_type_id uuid REFERENCES public.office_expense_types (id) ON DELETE RESTRICT,
  description text,
  paid boolean NOT NULL DEFAULT false,
  paid_at date,
  invoice text,
  payment_confirmation text,
  tax_receipt text,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid REFERENCES auth.users (id) ON DELETE SET NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT office_expenses_amount_chk CHECK (amount >= 0),
  CONSTRAINT office_expenses_paid_at_chk CHECK (paid = true OR paid_at IS NULL)
);

COMMENT ON TABLE public.office_expenses IS
  'Office expense lines per external firm (Admin → All Expenses → Office Expenses).';

COMMENT ON COLUMN public.office_expenses.firm_id IS 'FK → firms (vendor / firm).';
COMMENT ON COLUMN public.office_expenses.expense_type_id IS 'FK → office_expense_types.';
COMMENT ON COLUMN public.office_expenses.description IS 'Free-text notes about this expense.';
COMMENT ON COLUMN public.office_expenses.paid IS 'Whether this expense has been paid.';
COMMENT ON COLUMN public.office_expenses.paid_at IS 'Date paid (date only; set when paid = true).';
COMMENT ON COLUMN public.office_expenses.invoice IS
  'Object path in firm-invoice-documents bucket (same as firm_invoices / management costs).';
COMMENT ON COLUMN public.office_expenses.payment_confirmation IS
  'Object path in firm-management-payment-confirmations bucket.';
COMMENT ON COLUMN public.office_expenses.tax_receipt IS
  'Object path in firm-management-tax-receipts bucket.';

CREATE INDEX IF NOT EXISTS idx_office_expenses_firm_id
  ON public.office_expenses (firm_id);

CREATE INDEX IF NOT EXISTS idx_office_expenses_expense_type_id
  ON public.office_expenses (expense_type_id);

CREATE INDEX IF NOT EXISTS idx_office_expenses_created_at
  ON public.office_expenses (created_at DESC);

CREATE INDEX IF NOT EXISTS idx_office_expenses_paid
  ON public.office_expenses (paid, paid_at);

-- Auto-set created_by / created_at on insert
CREATE OR REPLACE FUNCTION public.set_office_expenses_audit()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.created_by IS NULL THEN
      NEW.created_by := auth.uid();
    END IF;
    IF NEW.created_at IS NULL THEN
      NEW.created_at := now();
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_office_expenses_audit ON public.office_expenses;
CREATE TRIGGER trg_office_expenses_audit
  BEFORE INSERT ON public.office_expenses
  FOR EACH ROW
  EXECUTE FUNCTION public.set_office_expenses_audit();

-- updated_at (uses same helper as firm_management_costs when available)
DROP TRIGGER IF EXISTS tr_office_expenses_updated_at ON public.office_expenses;
CREATE TRIGGER tr_office_expenses_updated_at
  BEFORE UPDATE ON public.office_expenses
  FOR EACH ROW
  EXECUTE FUNCTION public.firms_touch_updated_at();

-- -----------------------------------------------------------------------------
-- RLS
-- -----------------------------------------------------------------------------
ALTER TABLE public.office_expense_types ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.office_expenses ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "office_expense_types_authenticated_all" ON public.office_expense_types;
CREATE POLICY "office_expense_types_authenticated_all" ON public.office_expense_types
  FOR ALL TO authenticated
  USING (true)
  WITH CHECK (true);

DROP POLICY IF EXISTS "office_expenses_select" ON public.office_expenses;
CREATE POLICY "office_expenses_select" ON public.office_expenses
  FOR SELECT TO authenticated
  USING (true);

DROP POLICY IF EXISTS "office_expenses_insert" ON public.office_expenses;
CREATE POLICY "office_expenses_insert" ON public.office_expenses
  FOR INSERT TO authenticated
  WITH CHECK (auth.uid() IS NOT NULL);

DROP POLICY IF EXISTS "office_expenses_update" ON public.office_expenses;
CREATE POLICY "office_expenses_update" ON public.office_expenses
  FOR UPDATE TO authenticated
  USING (auth.uid() IS NOT NULL)
  WITH CHECK (auth.uid() IS NOT NULL);

DROP POLICY IF EXISTS "office_expenses_delete" ON public.office_expenses;
CREATE POLICY "office_expenses_delete" ON public.office_expenses
  FOR DELETE TO authenticated
  USING (auth.uid() IS NOT NULL);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.office_expense_types TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.office_expenses TO authenticated;

-- Existing deployments: allow optional expense type
ALTER TABLE public.office_expenses
  ALTER COLUMN expense_type_id DROP NOT NULL;
