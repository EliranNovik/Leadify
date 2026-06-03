-- Expense type lookup + FK on firm_management_costs
-- Run after 2026-04-10_firm_management_costs_and_invoices.sql

CREATE TABLE IF NOT EXISTS public.expense_types (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code text NOT NULL UNIQUE,
  label text NOT NULL,
  sort_order integer NOT NULL DEFAULT 0,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.expense_types IS 'Lookup: category for firm management cost lines.';
COMMENT ON COLUMN public.expense_types.code IS 'Stable machine key, e.g. marketing_expense';

INSERT INTO public.expense_types (code, label, sort_order)
VALUES
  ('marketing_expense', 'Marketing Expense', 10),
  ('rent', 'Rent', 20),
  ('office_expense', 'Office Expense', 30)
ON CONFLICT (code) DO UPDATE SET
  label = EXCLUDED.label,
  sort_order = EXCLUDED.sort_order,
  is_active = true;

ALTER TABLE public.firm_management_costs
  ADD COLUMN IF NOT EXISTS expense_type_id uuid REFERENCES public.expense_types (id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_firm_management_costs_expense_type
  ON public.firm_management_costs (expense_type_id);

COMMENT ON COLUMN public.firm_management_costs.expense_type_id IS 'FK → expense_types (Marketing Expense, Rent, Office Expense, …).';

ALTER TABLE public.expense_types ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "expense_types_authenticated_all" ON public.expense_types;
CREATE POLICY "expense_types_authenticated_all" ON public.expense_types
  FOR ALL TO authenticated
  USING (true)
  WITH CHECK (true);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.expense_types TO authenticated;
