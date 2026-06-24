-- Documents for internal (staff) calendar meetings that are not tied to a lead.
-- Lead-linked internal meetings continue to use lead_case_documents (sequence of events).

CREATE TABLE IF NOT EXISTS public.staff_meeting_documents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  meeting_id integer NOT NULL REFERENCES public.meetings (id) ON DELETE CASCADE,
  storage_path text NOT NULL,
  file_name text NOT NULL,
  file_size bigint,
  mime_type text,
  uploaded_by text,
  ai_summary text,
  ai_summary_status text,
  ai_summary_error text,
  ai_summary_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT staff_meeting_documents_meeting_path_unique UNIQUE (meeting_id, storage_path)
);

CREATE INDEX IF NOT EXISTS idx_staff_meeting_documents_meeting_id
  ON public.staff_meeting_documents (meeting_id);

ALTER TABLE public.staff_meeting_documents ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "staff_meeting_documents_select" ON public.staff_meeting_documents;
CREATE POLICY "staff_meeting_documents_select" ON public.staff_meeting_documents
  FOR SELECT USING (auth.uid() IS NOT NULL);

DROP POLICY IF EXISTS "staff_meeting_documents_insert" ON public.staff_meeting_documents;
CREATE POLICY "staff_meeting_documents_insert" ON public.staff_meeting_documents
  FOR INSERT WITH CHECK (auth.uid() IS NOT NULL);

DROP POLICY IF EXISTS "staff_meeting_documents_update" ON public.staff_meeting_documents;
CREATE POLICY "staff_meeting_documents_update" ON public.staff_meeting_documents
  FOR UPDATE USING (auth.uid() IS NOT NULL);

DROP POLICY IF EXISTS "staff_meeting_documents_delete" ON public.staff_meeting_documents;
CREATE POLICY "staff_meeting_documents_delete" ON public.staff_meeting_documents
  FOR DELETE USING (auth.uid() IS NOT NULL);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.staff_meeting_documents TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.staff_meeting_documents TO service_role;

-- Classification used when an internal meeting is linked to a lead.
INSERT INTO public.case_document_classifications (slug, label, sort_order) VALUES
  ('sequence_of_events', 'Sequence of Events', 45)
ON CONFLICT (slug) DO NOTHING;
