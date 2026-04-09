-- Links 1com-synced calls to new CRM leads (public.leads.id UUID).
-- Legacy leads continue to use call_logs.lead_id (bigint → leads_lead.id).

ALTER TABLE public.call_logs
  ADD COLUMN IF NOT EXISTS client_id UUID REFERENCES public.leads(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_call_logs_client_id_cdate
  ON public.call_logs (client_id, cdate DESC)
  WHERE client_id IS NOT NULL;

COMMENT ON COLUMN public.call_logs.client_id IS 'New CRM lead UUID (public.leads.id). Legacy leads use lead_id only.';
