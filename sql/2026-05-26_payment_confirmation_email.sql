-- Track automated payment confirmation emails (template misc_emailtemplate id 184)
ALTER TABLE payment_links
  ADD COLUMN IF NOT EXISTS payment_confirmation_email_sent_at TIMESTAMPTZ;

COMMENT ON COLUMN payment_links.payment_confirmation_email_sent_at IS
  'When the post-payment client confirmation email was sent (backend, Graph mailbox)';
