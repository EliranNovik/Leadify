-- Add "sent to finance" tracking columns used by FinancesTab "Send to finance" action.
-- Fixes: PGRST204 "Could not find the 'sent_to_finance' column of 'payment_plans' in the schema cache".

-- New (non-legacy) payment plans
ALTER TABLE payment_plans
  ADD COLUMN IF NOT EXISTS sent_to_finance BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS sent_to_finance_at TIMESTAMP WITH TIME ZONE;

COMMENT ON COLUMN payment_plans.sent_to_finance IS 'True when this payment row has been sent to the finance team';
COMMENT ON COLUMN payment_plans.sent_to_finance_at IS 'Timestamp when this payment row was sent to the finance team';

-- Legacy payment plan rows
ALTER TABLE finances_paymentplanrow
  ADD COLUMN IF NOT EXISTS sent_to_finance BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS sent_to_finance_at TIMESTAMP WITH TIME ZONE;

COMMENT ON COLUMN finances_paymentplanrow.sent_to_finance IS 'True when this payment row has been sent to the finance team';
COMMENT ON COLUMN finances_paymentplanrow.sent_to_finance_at IS 'Timestamp when this payment row was sent to the finance team';

-- Refresh PostgREST schema cache so Supabase recognises the new columns immediately
NOTIFY pgrst, 'reload schema';
