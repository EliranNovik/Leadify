-- Scheduled invoice send automation for payment plan rows (Finances tab).
-- When active, invoice email + WhatsApp are sent on the due date via the
-- payment-plan-invoice-automation edge function (daily cron).

-- New (non-legacy) payment plans
ALTER TABLE public.payment_plans
  ADD COLUMN IF NOT EXISTS invoice_send_automation_active BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS invoice_send_automation_language TEXT,
  ADD COLUMN IF NOT EXISTS invoice_send_automation_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS invoice_send_automation_sent_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS invoice_send_automation_by UUID;

COMMENT ON COLUMN public.payment_plans.invoice_send_automation_active IS
  'When true, send proforma invoice email + WhatsApp on due_date (once).';
COMMENT ON COLUMN public.payment_plans.invoice_send_automation_language IS
  'Template language for automated send: en or he.';
COMMENT ON COLUMN public.payment_plans.invoice_send_automation_at IS
  'When invoice send automation was enabled.';
COMMENT ON COLUMN public.payment_plans.invoice_send_automation_sent_at IS
  'When the automated invoice was actually sent (null = pending).';
COMMENT ON COLUMN public.payment_plans.invoice_send_automation_by IS
  'Auth user who enabled automation (mailbox used for email send).';

-- Legacy payment plan rows
ALTER TABLE public.finances_paymentplanrow
  ADD COLUMN IF NOT EXISTS invoice_send_automation_active BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS invoice_send_automation_language TEXT,
  ADD COLUMN IF NOT EXISTS invoice_send_automation_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS invoice_send_automation_sent_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS invoice_send_automation_by UUID;

COMMENT ON COLUMN public.finances_paymentplanrow.invoice_send_automation_active IS
  'When true, send proforma invoice email + WhatsApp on due_date (once).';
COMMENT ON COLUMN public.finances_paymentplanrow.invoice_send_automation_language IS
  'Template language for automated send: en or he.';
COMMENT ON COLUMN public.finances_paymentplanrow.invoice_send_automation_at IS
  'When invoice send automation was enabled.';
COMMENT ON COLUMN public.finances_paymentplanrow.invoice_send_automation_sent_at IS
  'When the automated invoice was actually sent (null = pending).';
COMMENT ON COLUMN public.finances_paymentplanrow.invoice_send_automation_by IS
  'Auth user who enabled automation (mailbox used for email send).';

CREATE INDEX IF NOT EXISTS idx_payment_plans_invoice_send_automation_due
  ON public.payment_plans (due_date)
  WHERE invoice_send_automation_active = TRUE
    AND invoice_send_automation_sent_at IS NULL
    AND cancel_date IS NULL;

CREATE INDEX IF NOT EXISTS idx_finances_ppr_invoice_send_automation_due
  ON public.finances_paymentplanrow (due_date)
  WHERE invoice_send_automation_active = TRUE
    AND invoice_send_automation_sent_at IS NULL
    AND cancel_date IS NULL;

NOTIFY pgrst, 'reload schema';

-- Optional daily cron (Supabase Dashboard → Edge Functions → payment-plan-invoice-automation):
--   PAYMENT_PLAN_INVOICE_AUTOMATION_CRON_SECRET=…
--   POST with header x-cron-secret (e.g. 08:00 Asia/Jerusalem)
-- Wire BACKEND_URL + CRM_PUBLIC_URL on the function before production sends.
