-- Simple indexes for lead_number, email, phone, name only
-- For leads table
CREATE INDEX IF NOT EXISTS idx_leads_lead_number ON public.leads (lead_number);
CREATE INDEX IF NOT EXISTS idx_leads_name_lower ON public.leads (lower(name));
CREATE INDEX IF NOT EXISTS idx_leads_email_lower ON public.leads (lower(email));
CREATE INDEX IF NOT EXISTS idx_leads_phone ON public.leads (phone) WHERE phone IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_leads_mobile ON public.leads (mobile) WHERE mobile IS NOT NULL;

-- For leads_lead table (legacy)
CREATE INDEX IF NOT EXISTS idx_leads_lead_id ON public.leads_lead (id);
CREATE INDEX IF NOT EXISTS idx_leads_lead_name_lower ON public.leads_lead (lower(name));
CREATE INDEX IF NOT EXISTS idx_leads_lead_email_lower ON public.leads_lead (lower(email));
CREATE INDEX IF NOT EXISTS idx_leads_lead_phone ON public.leads_lead (phone) WHERE phone IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_leads_lead_mobile ON public.leads_lead (mobile) WHERE mobile IS NOT NULL;

-- For leads_contact table
CREATE INDEX IF NOT EXISTS idx_leads_contact_name_lower ON public.leads_contact (lower(name));
CREATE INDEX IF NOT EXISTS idx_leads_contact_email_lower ON public.leads_contact (lower(email));
CREATE INDEX IF NOT EXISTS idx_leads_contact_phone ON public.leads_contact (phone) WHERE phone IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_leads_contact_mobile ON public.leads_contact (mobile) WHERE mobile IS NOT NULL;

