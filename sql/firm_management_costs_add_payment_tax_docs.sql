-- Payment confirmation & tax receipt paths on firm_management_costs (Storage buckets below)

ALTER TABLE public.firm_management_costs
  ADD COLUMN IF NOT EXISTS payment_confirmation text,
  ADD COLUMN IF NOT EXISTS tax_receipt text;

COMMENT ON COLUMN public.firm_management_costs.payment_confirmation IS
  'Object path in firm-management-payment-confirmations bucket.';

COMMENT ON COLUMN public.firm_management_costs.tax_receipt IS
  'Object path in firm-management-tax-receipts bucket.';
