-- Tablet claims device token after CRM completes pairing (one-time delivery).
ALTER TABLE public.kiosk_pairing_codes
  ADD COLUMN IF NOT EXISTS pending_device_token TEXT,
  ADD COLUMN IF NOT EXISTS token_claimed_at TIMESTAMPTZ;
