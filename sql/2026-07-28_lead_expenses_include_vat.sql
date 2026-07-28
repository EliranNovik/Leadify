-- Add VAT flag for lead expenses (drawer: with VAT / without VAT).
-- Run after sql/2026-07-28_lead_expenses.sql

ALTER TABLE public.lead_expenses
  ADD COLUMN IF NOT EXISTS include_vat boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.lead_expenses.include_vat IS
  'When true, linked Finances expense row stores VAT (value_vat / vat_value). Default false (without VAT).';

CREATE INDEX IF NOT EXISTS idx_lead_expenses_include_vat
  ON public.lead_expenses (include_vat)
  WHERE include_vat = true;
