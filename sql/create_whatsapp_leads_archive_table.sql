-- Archive unconnected WhatsApp lead conversations by phone_number (WhatsApp Leads page)

CREATE TABLE IF NOT EXISTS public.whatsapp_leads_archive (
  phone_number TEXT PRIMARY KEY,
  archived_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  archived_by UUID REFERENCES auth.users(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_whatsapp_leads_archive_archived_at
  ON public.whatsapp_leads_archive (archived_at DESC);

ALTER TABLE public.whatsapp_leads_archive ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "whatsapp_leads_archive_authenticated_all" ON public.whatsapp_leads_archive;
CREATE POLICY "whatsapp_leads_archive_authenticated_all"
  ON public.whatsapp_leads_archive
  FOR ALL
  TO authenticated
  USING (true)
  WITH CHECK (true);

GRANT SELECT, INSERT, DELETE ON public.whatsapp_leads_archive TO authenticated;

COMMENT ON TABLE public.whatsapp_leads_archive IS
  'Phone numbers archived from the WhatsApp Leads inbox (hidden from main list until restored).';
