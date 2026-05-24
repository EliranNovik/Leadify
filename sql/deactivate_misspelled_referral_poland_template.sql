-- Meta registers this template as "refferal_poland" (double f).
-- Rows named "referral_poland" (single f) cause WhatsApp API error #132001.
-- Safe to re-run: only deactivates the misspelled name.

UPDATE whatsapp_templates_v2
SET active = false,
    updated_at = NOW()
WHERE name = 'referral_poland'
  AND active = true;
