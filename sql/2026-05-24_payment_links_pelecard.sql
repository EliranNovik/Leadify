-- Pelecard fields on payment_links (run in Supabase SQL editor)
ALTER TABLE payment_links
  ADD COLUMN IF NOT EXISTS pelecard_session_url TEXT,
  ADD COLUMN IF NOT EXISTS pelecard_transaction_id TEXT,
  ADD COLUMN IF NOT EXISTS pelecard_confirmation_key TEXT,
  ADD COLUMN IF NOT EXISTS pelecard_voucher_id TEXT,
  ADD COLUMN IF NOT EXISTS pelecard_auth_number TEXT,
  ADD COLUMN IF NOT EXISTS pelecard_status_code TEXT,
  ADD COLUMN IF NOT EXISTS pelecard_raw_response JSONB;

-- Allow processing / failed / cancelled / expired statuses (if status is text without constraint, no-op)
COMMENT ON COLUMN payment_links.pelecard_session_url IS 'Last Pelecard hosted checkout URL';
COMMENT ON COLUMN payment_links.pelecard_transaction_id IS 'Pelecard transaction id from redirect/callback';
