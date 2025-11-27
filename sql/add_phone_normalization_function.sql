-- Helper used by the unified search to normalize phone numbers.
-- It strips all non-digit characters, handles +972 prefixes, and trims to the last 10 digits.

CREATE OR REPLACE FUNCTION public.normalize_phone(phone_text TEXT)
RETURNS TEXT
LANGUAGE plpgsql
AS $$
DECLARE
  digits TEXT;
BEGIN
  IF phone_text IS NULL THEN
    RETURN NULL;
  END IF;

  digits := regexp_replace(phone_text, '\D', '', 'g');

  IF digits = '' THEN
    RETURN NULL;
  END IF;

  -- Convert Israeli country code to local prefix when applicable.
  IF length(digits) > 9 AND digits LIKE '972%' THEN
    digits := '0' || substr(digits, 4);
  END IF;

  -- Keep the last 10 digits for comparison to align with most local formats.
  IF length(digits) > 10 THEN
    digits := right(digits, 10);
  END IF;

  RETURN digits;
END;
$$ IMMUTABLE;

