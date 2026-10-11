-- Per-row record that the *tax* invoice was sent to the client.
--
-- Distinct from `invoice_sent`, which tracks the proforma / payment-request invoice. The tax invoice
-- is normally produced automatically by Payper when a payment link is paid (payment_links.payper_invoice_*),
-- but invoices issued outside that flow have nowhere to be recorded, so these columns let a user say
-- "this one was sent, on this date, by me".

ALTER TABLE public.payment_plans
  ADD COLUMN IF NOT EXISTS tax_invoice_sent BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS tax_invoice_sent_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS tax_invoice_sent_by BIGINT;

ALTER TABLE public.finances_paymentplanrow
  ADD COLUMN IF NOT EXISTS tax_invoice_sent BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS tax_invoice_sent_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS tax_invoice_sent_by BIGINT;

COMMENT ON COLUMN public.payment_plans.tax_invoice_sent IS
  'True after a user marked the tax invoice as sent to the client by hand. The automated Payper tax receipt is tracked on payment_links instead.';
COMMENT ON COLUMN public.payment_plans.tax_invoice_sent_at IS
  'When the tax invoice was sent, as stated by the user marking it (not necessarily when they pressed the button).';
COMMENT ON COLUMN public.payment_plans.tax_invoice_sent_by IS
  'tenants_employee.id of whoever marked the tax invoice as sent.';
COMMENT ON COLUMN public.finances_paymentplanrow.tax_invoice_sent IS
  'True after a user marked the tax invoice as sent to the client by hand. The automated Payper tax receipt is tracked on payment_links instead.';
COMMENT ON COLUMN public.finances_paymentplanrow.tax_invoice_sent_at IS
  'When the tax invoice was sent, as stated by the user marking it (not necessarily when they pressed the button).';
COMMENT ON COLUMN public.finances_paymentplanrow.tax_invoice_sent_by IS
  'tenants_employee.id of whoever marked the tax invoice as sent.';

-- Reports filter on "sent", so only those rows are worth indexing.
CREATE INDEX IF NOT EXISTS idx_payment_plans_tax_invoice_sent
  ON public.payment_plans (tax_invoice_sent)
  WHERE tax_invoice_sent = TRUE;

CREATE INDEX IF NOT EXISTS idx_finances_ppr_tax_invoice_sent
  ON public.finances_paymentplanrow (tax_invoice_sent)
  WHERE tax_invoice_sent = TRUE;

NOTIFY pgrst, 'reload schema';
