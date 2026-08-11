-- Optional small indexes — run separately in SQL editor if needed.
-- Skip if this also times out; use the psql file for emails indexes instead.

CREATE INDEX IF NOT EXISTS idx_leads_lead_linked_master_lead
ON public.leads_lead (linked_master_lead)
WHERE linked_master_lead IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_leads_linked_master_lead
ON public.leads (linked_master_lead)
WHERE linked_master_lead IS NOT NULL;
