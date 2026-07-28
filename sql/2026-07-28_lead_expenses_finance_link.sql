-- Link lead_expenses ↔ Finances payment rows; drop receipt columns (invoices live on Finances).
-- Run after sql/2026-07-28_lead_expenses.sql

ALTER TABLE public.lead_expenses
  ADD COLUMN IF NOT EXISTS payment_plan_id bigint,
  ADD COLUMN IF NOT EXISTS legacy_payment_plan_row_id bigint;

COMMENT ON COLUMN public.lead_expenses.payment_plan_id IS
  'Linked payment_plans.id (new leads) — Expense (no VAT) finance row.';
COMMENT ON COLUMN public.lead_expenses.legacy_payment_plan_row_id IS
  'Linked finances_paymentplanrow.id (legacy leads) — order 99 Expense (no VAT).';

CREATE INDEX IF NOT EXISTS idx_lead_expenses_payment_plan
  ON public.lead_expenses (payment_plan_id)
  WHERE payment_plan_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_lead_expenses_legacy_payment_plan
  ON public.lead_expenses (legacy_payment_plan_row_id)
  WHERE legacy_payment_plan_row_id IS NOT NULL;

-- Receipts/invoices are managed on the Finances payment row
ALTER TABLE public.lead_expenses
  DROP COLUMN IF EXISTS receipt_storage_path,
  DROP COLUMN IF EXISTS receipt_file_name;
