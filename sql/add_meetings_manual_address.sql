-- Optional free-text address on meetings (independent of location picker / custom_address).
-- Intended for WhatsApp and email templates.

ALTER TABLE public.meetings
ADD COLUMN IF NOT EXISTS manual_address text NULL;

COMMENT ON COLUMN public.meetings.manual_address IS
  'Optional manual meeting address (street, city, parking, etc.) for notifications and templates. Separate from custom_address tied to the Custom Address location type.';
