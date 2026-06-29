-- Terminal profile used for Pelecard checkout (production vs sandbox credentials)
ALTER TABLE payment_links
  ADD COLUMN IF NOT EXISTS pelecard_profile TEXT NOT NULL DEFAULT 'production';

COMMENT ON COLUMN payment_links.pelecard_profile IS 'Pelecard terminal profile: production | sandbox — set at checkout session init';
