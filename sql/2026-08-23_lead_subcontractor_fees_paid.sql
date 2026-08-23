-- Paid / unpaid status for subcontractor fee lines (Expenses & Fees tab).

ALTER TABLE public.lead_subcontractor_fees
  ADD COLUMN IF NOT EXISTS paid boolean NOT NULL DEFAULT false;

ALTER TABLE public.lead_subcontractor_fees
  ADD COLUMN IF NOT EXISTS paid_at timestamptz;

COMMENT ON COLUMN public.lead_subcontractor_fees.paid IS
  'Whether this fee line has been marked paid.';

COMMENT ON COLUMN public.lead_subcontractor_fees.paid_at IS
  'When the fee was marked paid. Null when unpaid.';

CREATE INDEX IF NOT EXISTS idx_lead_subcontractor_fees_paid
  ON public.lead_subcontractor_fees (paid)
  WHERE paid = false;
