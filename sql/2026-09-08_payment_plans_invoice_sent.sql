-- Per-row flag: proforma / payment-request invoice was sent to the client.
-- Used for payment-plan status "Invoice sent" (after Sent to finance, before Paid).

ALTER TABLE public.payment_plans
  ADD COLUMN IF NOT EXISTS invoice_sent BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS invoice_sent_at TIMESTAMPTZ;

ALTER TABLE public.finances_paymentplanrow
  ADD COLUMN IF NOT EXISTS invoice_sent BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS invoice_sent_at TIMESTAMPTZ;

COMMENT ON COLUMN public.payment_plans.invoice_sent IS
  'True after the proforma invoice was sent to the client (email and/or WhatsApp).';
COMMENT ON COLUMN public.payment_plans.invoice_sent_at IS
  'When the proforma invoice was sent to the client.';
COMMENT ON COLUMN public.finances_paymentplanrow.invoice_sent IS
  'True after the proforma invoice was sent to the client (email and/or WhatsApp).';
COMMENT ON COLUMN public.finances_paymentplanrow.invoice_sent_at IS
  'When the proforma invoice was sent to the client.';

-- Rows already sent by due-date automation
UPDATE public.payment_plans
SET
  invoice_sent = TRUE,
  invoice_sent_at = COALESCE(invoice_sent_at, invoice_send_automation_sent_at)
WHERE invoice_send_automation_sent_at IS NOT NULL
  AND (invoice_sent = FALSE OR invoice_sent_at IS NULL);

UPDATE public.finances_paymentplanrow
SET
  invoice_sent = TRUE,
  invoice_sent_at = COALESCE(invoice_sent_at, invoice_send_automation_sent_at)
WHERE invoice_send_automation_sent_at IS NOT NULL
  AND (invoice_sent = FALSE OR invoice_sent_at IS NULL);

CREATE INDEX IF NOT EXISTS idx_payment_plans_invoice_sent
  ON public.payment_plans (invoice_sent)
  WHERE invoice_sent = TRUE;

CREATE INDEX IF NOT EXISTS idx_finances_ppr_invoice_sent
  ON public.finances_paymentplanrow (invoice_sent)
  WHERE invoice_sent = TRUE;

NOTIFY pgrst, 'reload schema';
