-- Timeline fetch for legacy leads: filter by lead_id, order by cdate
CREATE INDEX IF NOT EXISTS idx_leads_leadinteractions_lead_id_cdate_desc
  ON public.leads_leadinteractions (lead_id, cdate DESC)
  WHERE lead_id IS NOT NULL;
