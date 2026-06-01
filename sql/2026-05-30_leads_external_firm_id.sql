-- Link leads to external subcontractor firms (public.firms).

ALTER TABLE public.leads
  ADD COLUMN IF NOT EXISTS external_firm_id UUID;

ALTER TABLE public.leads
  DROP CONSTRAINT IF EXISTS leads_external_firm_id_fkey;

ALTER TABLE public.leads
  ADD CONSTRAINT leads_external_firm_id_fkey
  FOREIGN KEY (external_firm_id) REFERENCES public.firms (id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_leads_external_firm_id
  ON public.leads (external_firm_id)
  WHERE external_firm_id IS NOT NULL;

COMMENT ON COLUMN public.leads.external_firm_id IS 'Subcontractor / external firm (public.firms)';

ALTER TABLE public.leads_lead
  ADD COLUMN IF NOT EXISTS external_firm_id UUID;

ALTER TABLE public.leads_lead
  DROP CONSTRAINT IF EXISTS leads_lead_external_firm_id_fkey;

ALTER TABLE public.leads_lead
  ADD CONSTRAINT leads_lead_external_firm_id_fkey
  FOREIGN KEY (external_firm_id) REFERENCES public.firms (id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_leads_lead_external_firm_id
  ON public.leads_lead (external_firm_id)
  WHERE external_firm_id IS NOT NULL;

COMMENT ON COLUMN public.leads_lead.external_firm_id IS 'Subcontractor / external firm (public.firms)';
