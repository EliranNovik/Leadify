-- Indexes for the lead_leadcontact junction table used when linking contacts to leads.

CREATE INDEX IF NOT EXISTS idx_lead_leadcontact_contact_lead_newlead
  ON public.lead_leadcontact (contact_id, lead_id, newlead_id);

CREATE INDEX IF NOT EXISTS idx_lead_leadcontact_lead_main
  ON public.lead_leadcontact (lead_id, main);

CREATE INDEX IF NOT EXISTS idx_lead_leadcontact_newlead_main
  ON public.lead_leadcontact (newlead_id, main);

