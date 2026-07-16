-- Folders for documents attached to a lead_sub_efforts row (Sub-effort modal documents box).
-- Document membership uses optional folder_id on items in lead_sub_efforts.document_url JSON.

CREATE TABLE IF NOT EXISTS public.lead_sub_effort_folders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_sub_effort_id bigint NOT NULL REFERENCES public.lead_sub_efforts (id) ON DELETE CASCADE,
  title text NOT NULL,
  note text NULL,
  created_by text NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  sort_order integer NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_lead_sub_effort_folders_sub_effort
  ON public.lead_sub_effort_folders (lead_sub_effort_id, sort_order, created_at);

COMMENT ON TABLE public.lead_sub_effort_folders IS
  'Named folders inside a sub-effort documents box. Items reference folder via document_url[].folder_id.';
COMMENT ON COLUMN public.lead_sub_effort_folders.note IS
  'Optional tip text shown on a badge when hovering the folder.';

ALTER TABLE public.lead_sub_effort_folders ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "lead_sub_effort_folders_select" ON public.lead_sub_effort_folders;
CREATE POLICY "lead_sub_effort_folders_select" ON public.lead_sub_effort_folders
  FOR SELECT USING (auth.uid() IS NOT NULL);

DROP POLICY IF EXISTS "lead_sub_effort_folders_insert" ON public.lead_sub_effort_folders;
CREATE POLICY "lead_sub_effort_folders_insert" ON public.lead_sub_effort_folders
  FOR INSERT WITH CHECK (auth.uid() IS NOT NULL);

DROP POLICY IF EXISTS "lead_sub_effort_folders_update" ON public.lead_sub_effort_folders;
CREATE POLICY "lead_sub_effort_folders_update" ON public.lead_sub_effort_folders
  FOR UPDATE USING (auth.uid() IS NOT NULL);

DROP POLICY IF EXISTS "lead_sub_effort_folders_delete" ON public.lead_sub_effort_folders;
CREATE POLICY "lead_sub_effort_folders_delete" ON public.lead_sub_effort_folders
  FOR DELETE USING (auth.uid() IS NOT NULL);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.lead_sub_effort_folders TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.lead_sub_effort_folders TO service_role;
