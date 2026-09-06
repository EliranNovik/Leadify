-- WhatsApp 24h reply window on new leads (public.leads).
-- PEX (anon role / shared anon key) may UPDATE this column only.

ALTER TABLE public.leads
  ADD COLUMN IF NOT EXISTS wa_window_expires_at timestamptz;

COMMENT ON COLUMN public.leads.wa_window_expires_at IS
  'When the WhatsApp 24h customer-care window closes for this lead. Written by PEX after a client inbound message.';

CREATE INDEX IF NOT EXISTS idx_leads_wa_window_expires_at
  ON public.leads (wa_window_expires_at)
  WHERE wa_window_expires_at IS NOT NULL;

ALTER TABLE public.leads ENABLE ROW LEVEL SECURITY;

GRANT SELECT ON public.leads TO anon;

-- Do not give anon table-wide UPDATE. Column grant is what limits them to this field.
REVOKE UPDATE ON TABLE public.leads FROM anon;
GRANT UPDATE (wa_window_expires_at) ON TABLE public.leads TO anon;

DROP POLICY IF EXISTS "pex_update_leads_wa_window" ON public.leads;
CREATE POLICY "pex_update_leads_wa_window"
  ON public.leads
  FOR UPDATE
  TO anon
  USING (true)
  WITH CHECK (true);
