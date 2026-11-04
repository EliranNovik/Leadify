-- Track WhatsApp payment reminders sent from AI chat (templates 52/53).
-- Count increments per successful send that stamped this payment row; date is the latest send.

ALTER TABLE public.payment_plans
  ADD COLUMN IF NOT EXISTS payment_reminder_sent_count INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS payment_reminder_sent_at TIMESTAMPTZ;

ALTER TABLE public.finances_paymentplanrow
  ADD COLUMN IF NOT EXISTS payment_reminder_sent_count INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS payment_reminder_sent_at TIMESTAMPTZ;

COMMENT ON COLUMN public.payment_plans.payment_reminder_sent_count IS
  'How many WhatsApp payment reminders were recorded against this unpaid invoiced row.';
COMMENT ON COLUMN public.payment_plans.payment_reminder_sent_at IS
  'When the latest payment reminder WhatsApp was sent for this row.';
COMMENT ON COLUMN public.finances_paymentplanrow.payment_reminder_sent_count IS
  'How many WhatsApp payment reminders were recorded against this unpaid invoiced row.';
COMMENT ON COLUMN public.finances_paymentplanrow.payment_reminder_sent_at IS
  'When the latest payment reminder WhatsApp was sent for this row.';

CREATE INDEX IF NOT EXISTS idx_payment_plans_payment_reminder_sent_at
  ON public.payment_plans (payment_reminder_sent_at)
  WHERE payment_reminder_sent_at IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_finances_ppr_payment_reminder_sent_at
  ON public.finances_paymentplanrow (payment_reminder_sent_at)
  WHERE payment_reminder_sent_at IS NOT NULL;

NOTIFY pgrst, 'reload schema';
