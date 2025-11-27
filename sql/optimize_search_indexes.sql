-- Optimize indexes for the leads table to improve search performance.
-- These indexes target the fields referenced by the unified search function.

-- It's safe to run this file multiple times thanks to IF NOT EXISTS guards.

CREATE INDEX IF NOT EXISTS idx_leads_lead_number
  ON public.leads (lead_number);

CREATE INDEX IF NOT EXISTS idx_leads_lead_number_lower
  ON public.leads (lower(lead_number));

CREATE INDEX IF NOT EXISTS idx_leads_name_lower
  ON public.leads (lower(name));

CREATE INDEX IF NOT EXISTS idx_leads_email_lower
  ON public.leads (lower(email));

CREATE INDEX IF NOT EXISTS idx_leads_topic_lower
  ON public.leads (lower(topic));

CREATE INDEX IF NOT EXISTS idx_leads_phone_digits
  ON public.leads ((regexp_replace(coalesce(phone, ''), '\D', '', 'g')))
  WHERE phone IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_leads_mobile_digits
  ON public.leads ((regexp_replace(coalesce(mobile, ''), '\D', '', 'g')))
  WHERE mobile IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_leads_lead_number_name
  ON public.leads (lead_number, name);

-- Ensure legacy leads phone/email columns have supporting indexes as well.
CREATE INDEX IF NOT EXISTS idx_leads_lead_email_lower
  ON public.leads_lead (lower(email));

CREATE INDEX IF NOT EXISTS idx_leads_lead_phone_digits
  ON public.leads_lead ((regexp_replace(coalesce(phone, ''), '\D', '', 'g')))
  WHERE phone IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_leads_lead_mobile_digits
  ON public.leads_lead ((regexp_replace(coalesce(mobile, ''), '\D', '', 'g')))
  WHERE mobile IS NOT NULL;

