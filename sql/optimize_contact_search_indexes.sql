-- Indexes to speed up contact level filtering for the unified lead search.

CREATE INDEX IF NOT EXISTS idx_leads_contact_name_lower
  ON public.leads_contact (lower(name));

CREATE INDEX IF NOT EXISTS idx_leads_contact_email_lower
  ON public.leads_contact (lower(email));

CREATE INDEX IF NOT EXISTS idx_leads_contact_phone_digits
  ON public.leads_contact ((regexp_replace(coalesce(phone, ''), '\D', '', 'g')))
  WHERE phone IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_leads_contact_mobile_digits
  ON public.leads_contact ((regexp_replace(coalesce(mobile, ''), '\D', '', 'g')))
  WHERE mobile IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_leads_contact_newlead_id
  ON public.leads_contact (newlead_id);

