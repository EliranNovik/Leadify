-- Last WhatsApp send from a partner / external firm, on the lead row.

ALTER TABLE public.leads
  ADD COLUMN IF NOT EXISTS whatsapp_timestamp timestamptz;

COMMENT ON COLUMN public.leads.whatsapp_timestamp IS
  'When a partner / external firm last sent a WhatsApp message for this lead.';

CREATE INDEX IF NOT EXISTS idx_leads_whatsapp_timestamp
  ON public.leads (whatsapp_timestamp DESC)
  WHERE whatsapp_timestamp IS NOT NULL;

ALTER TABLE public.leads_lead
  ADD COLUMN IF NOT EXISTS whatsapp_timestamp timestamptz;

COMMENT ON COLUMN public.leads_lead.whatsapp_timestamp IS
  'When a partner / external firm last sent a WhatsApp message for this lead.';

CREATE INDEX IF NOT EXISTS idx_leads_lead_whatsapp_timestamp
  ON public.leads_lead (whatsapp_timestamp DESC)
  WHERE whatsapp_timestamp IS NOT NULL;
