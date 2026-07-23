-- Recruitment ATS Phase 1: stages, candidates, stage history, meetings.user_id, documents + bucket
-- Run in Supabase SQL editor.

-- ---------------------------------------------------------------------------
-- Stages catalog
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.recruitment_stages (
  id SERIAL PRIMARY KEY,
  slug TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  colour TEXT NOT NULL DEFAULT '#6b7280',
  sort_order INTEGER NOT NULL DEFAULT 0,
  is_terminal BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO public.recruitment_stages (slug, name, colour, sort_order, is_terminal) VALUES
  ('new_applicant', 'New applicant', '#3b82f6', 10, FALSE),
  ('cv_reviewed', 'CV reviewed', '#6366f1', 20, FALSE),
  ('phone_screening', 'Phone screening', '#8b5cf6', 30, FALSE),
  ('interview_1', 'Interview 1', '#a855f7', 40, FALSE),
  ('interview_2', 'Interview 2', '#d946ef', 50, FALSE),
  ('professional_test', 'Professional test', '#ec4899', 60, FALSE),
  ('references', 'References', '#f43f5e', 70, FALSE),
  ('offer_sent', 'Offer sent', '#f59e0b', 80, FALSE),
  ('accepted', 'Accepted', '#10b981', 90, FALSE),
  ('declined', 'Declined', '#ef4444', 100, TRUE),
  ('hired', 'Hired', '#059669', 110, TRUE),
  ('archived', 'Archived', '#9ca3af', 120, TRUE)
ON CONFLICT (slug) DO UPDATE SET
  name = EXCLUDED.name,
  colour = EXCLUDED.colour,
  sort_order = EXCLUDED.sort_order,
  is_terminal = EXCLUDED.is_terminal;

-- ---------------------------------------------------------------------------
-- Candidates (1:1 with users for hire/contracts identity)
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.recruitment_candidates (
  id BIGSERIAL PRIMARY KEY,
  user_id UUID NOT NULL UNIQUE REFERENCES public.users(id) ON DELETE CASCADE,
  stage_id INTEGER NOT NULL REFERENCES public.recruitment_stages(id),
  stage_changed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  stage_changed_by TEXT,
  position_applied TEXT,
  department_id INTEGER REFERENCES public.tenant_departement(id) ON DELETE SET NULL,
  recruiter_employee_id INTEGER REFERENCES public.tenants_employee(id) ON DELETE SET NULL,
  referred_by_employee_id INTEGER REFERENCES public.tenants_employee(id) ON DELETE SET NULL,
  source TEXT,
  expected_salary TEXT,
  availability TEXT,
  notice_period TEXT,
  rating NUMERIC(3,1),
  overall_score NUMERIC(5,2),
  notes TEXT,
  phone TEXT,
  linkedin_url TEXT,
  address TEXT,
  nationality TEXT,
  languages JSONB DEFAULT '[]'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS recruitment_candidates_stage_id_idx
  ON public.recruitment_candidates (stage_id);
CREATE INDEX IF NOT EXISTS recruitment_candidates_recruiter_idx
  ON public.recruitment_candidates (recruiter_employee_id);
CREATE INDEX IF NOT EXISTS recruitment_candidates_referred_by_idx
  ON public.recruitment_candidates (referred_by_employee_id);
CREATE INDEX IF NOT EXISTS recruitment_candidates_stage_changed_at_idx
  ON public.recruitment_candidates (stage_changed_at DESC);

-- ---------------------------------------------------------------------------
-- Stage history
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.recruitment_candidate_stage_history (
  id BIGSERIAL PRIMARY KEY,
  candidate_id BIGINT NOT NULL REFERENCES public.recruitment_candidates(id) ON DELETE CASCADE,
  stage_id INTEGER NOT NULL REFERENCES public.recruitment_stages(id),
  changed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  changed_by TEXT,
  changed_by_employee_id INTEGER REFERENCES public.tenants_employee(id) ON DELETE SET NULL,
  note TEXT
);

CREATE INDEX IF NOT EXISTS recruitment_candidate_stage_history_candidate_idx
  ON public.recruitment_candidate_stage_history (candidate_id, changed_at DESC);

-- ---------------------------------------------------------------------------
-- Meetings: allow recruitment user as subject
-- ---------------------------------------------------------------------------

ALTER TABLE public.meetings
  ADD COLUMN IF NOT EXISTS user_id UUID REFERENCES public.users(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS meetings_user_id_idx ON public.meetings (user_id)
  WHERE user_id IS NOT NULL;

-- Allow recruitment interview meetings in meetings.calendar_type
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'meetings_calendar_type_check'
  ) THEN
    ALTER TABLE public.meetings DROP CONSTRAINT meetings_calendar_type_check;
  END IF;
EXCEPTION WHEN undefined_table THEN
  NULL;
END $$;

ALTER TABLE public.meetings
  ADD CONSTRAINT meetings_calendar_type_check CHECK (
    (calendar_type)::text = ANY (
      (ARRAY[
        'potential_client'::character varying,
        'active_client'::character varying,
        'staff'::character varying,
        'recruitment'::character varying
      ])::text[]
    )
  );

-- ---------------------------------------------------------------------------
-- Document types + documents
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.recruitment_document_types (
  id SERIAL PRIMARY KEY,
  slug TEXT NOT NULL UNIQUE,
  label TEXT NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO public.recruitment_document_types (slug, label, sort_order) VALUES
  ('cv', 'CV', 10),
  ('cover_letter', 'Cover letter', 20),
  ('certificate', 'Certificates', 30),
  ('degree', 'Degrees', 40),
  ('id', 'ID', 50),
  ('references', 'References', 60),
  ('portfolio', 'Portfolio', 70),
  ('test_results', 'Test results', 80),
  ('nda', 'Signed NDA', 90),
  ('offer', 'Signed offer', 100),
  ('other', 'Other', 110)
ON CONFLICT (slug) DO UPDATE SET
  label = EXCLUDED.label,
  sort_order = EXCLUDED.sort_order,
  is_active = TRUE;

CREATE TABLE IF NOT EXISTS public.recruitment_documents (
  id BIGSERIAL PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  candidate_id BIGINT REFERENCES public.recruitment_candidates(id) ON DELETE SET NULL,
  document_type_id INTEGER NOT NULL REFERENCES public.recruitment_document_types(id),
  storage_path TEXT NOT NULL,
  file_name TEXT NOT NULL,
  mime_type TEXT,
  notes TEXT,
  version INTEGER NOT NULL DEFAULT 1,
  uploaded_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS recruitment_documents_user_id_idx
  ON public.recruitment_documents (user_id);
CREATE INDEX IF NOT EXISTS recruitment_documents_candidate_id_idx
  ON public.recruitment_documents (candidate_id);
CREATE INDEX IF NOT EXISTS recruitment_documents_type_id_idx
  ON public.recruitment_documents (document_type_id);

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------

ALTER TABLE public.recruitment_stages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.recruitment_candidates ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.recruitment_candidate_stage_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.recruitment_document_types ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.recruitment_documents ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "recruitment_stages_select" ON public.recruitment_stages;
CREATE POLICY "recruitment_stages_select" ON public.recruitment_stages
  FOR SELECT TO authenticated USING (TRUE);

DROP POLICY IF EXISTS "recruitment_stages_manage" ON public.recruitment_stages;
CREATE POLICY "recruitment_stages_manage" ON public.recruitment_stages
  FOR ALL TO authenticated
  USING (public.is_app_superuser())
  WITH CHECK (public.is_app_superuser());

DROP POLICY IF EXISTS "recruitment_candidates_select" ON public.recruitment_candidates;
CREATE POLICY "recruitment_candidates_select" ON public.recruitment_candidates
  FOR SELECT TO authenticated USING (TRUE);

DROP POLICY IF EXISTS "recruitment_candidates_write" ON public.recruitment_candidates;
CREATE POLICY "recruitment_candidates_write" ON public.recruitment_candidates
  FOR ALL TO authenticated
  USING (public.is_app_superuser())
  WITH CHECK (public.is_app_superuser());

DROP POLICY IF EXISTS "recruitment_stage_history_select" ON public.recruitment_candidate_stage_history;
CREATE POLICY "recruitment_stage_history_select" ON public.recruitment_candidate_stage_history
  FOR SELECT TO authenticated USING (TRUE);

DROP POLICY IF EXISTS "recruitment_stage_history_write" ON public.recruitment_candidate_stage_history;
CREATE POLICY "recruitment_stage_history_write" ON public.recruitment_candidate_stage_history
  FOR ALL TO authenticated
  USING (public.is_app_superuser())
  WITH CHECK (public.is_app_superuser());

DROP POLICY IF EXISTS "recruitment_document_types_select" ON public.recruitment_document_types;
CREATE POLICY "recruitment_document_types_select" ON public.recruitment_document_types
  FOR SELECT TO authenticated USING (is_active IS TRUE OR public.is_app_superuser());

DROP POLICY IF EXISTS "recruitment_document_types_manage" ON public.recruitment_document_types;
CREATE POLICY "recruitment_document_types_manage" ON public.recruitment_document_types
  FOR ALL TO authenticated
  USING (public.is_app_superuser())
  WITH CHECK (public.is_app_superuser());

DROP POLICY IF EXISTS "recruitment_documents_select" ON public.recruitment_documents;
CREATE POLICY "recruitment_documents_select" ON public.recruitment_documents
  FOR SELECT TO authenticated USING (public.is_app_superuser());

DROP POLICY IF EXISTS "recruitment_documents_write" ON public.recruitment_documents;
CREATE POLICY "recruitment_documents_write" ON public.recruitment_documents
  FOR ALL TO authenticated
  USING (public.is_app_superuser())
  WITH CHECK (public.is_app_superuser());

GRANT SELECT ON public.recruitment_stages TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.recruitment_candidates TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.recruitment_candidate_stage_history TO authenticated;
GRANT SELECT ON public.recruitment_document_types TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.recruitment_documents TO authenticated;
GRANT USAGE, SELECT ON SEQUENCE public.recruitment_stages_id_seq TO authenticated;
GRANT USAGE, SELECT ON SEQUENCE public.recruitment_candidates_id_seq TO authenticated;
GRANT USAGE, SELECT ON SEQUENCE public.recruitment_candidate_stage_history_id_seq TO authenticated;
GRANT USAGE, SELECT ON SEQUENCE public.recruitment_document_types_id_seq TO authenticated;
GRANT USAGE, SELECT ON SEQUENCE public.recruitment_documents_id_seq TO authenticated;

-- ---------------------------------------------------------------------------
-- Storage bucket
-- ---------------------------------------------------------------------------

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'recruitment-documents',
  'recruitment-documents',
  false,
  20971520,
  ARRAY[
    'image/jpeg',
    'image/jpg',
    'image/png',
    'image/gif',
    'image/webp',
    'application/pdf',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.ms-excel',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
  ]
)
ON CONFLICT (id) DO UPDATE SET
  public = false,
  file_size_limit = 20971520;

DROP POLICY IF EXISTS "recruitment-documents upload policy" ON storage.objects;
DROP POLICY IF EXISTS "recruitment-documents select policy" ON storage.objects;
DROP POLICY IF EXISTS "recruitment-documents update policy" ON storage.objects;
DROP POLICY IF EXISTS "recruitment-documents delete policy" ON storage.objects;

CREATE POLICY "recruitment-documents upload policy" ON storage.objects
FOR INSERT TO authenticated
WITH CHECK (bucket_id = 'recruitment-documents' AND public.is_app_superuser());

CREATE POLICY "recruitment-documents select policy" ON storage.objects
FOR SELECT TO authenticated
USING (bucket_id = 'recruitment-documents' AND public.is_app_superuser());

CREATE POLICY "recruitment-documents update policy" ON storage.objects
FOR UPDATE TO authenticated
USING (bucket_id = 'recruitment-documents' AND public.is_app_superuser())
WITH CHECK (bucket_id = 'recruitment-documents' AND public.is_app_superuser());

CREATE POLICY "recruitment-documents delete policy" ON storage.objects
FOR DELETE TO authenticated
USING (bucket_id = 'recruitment-documents' AND public.is_app_superuser());

-- ---------------------------------------------------------------------------
-- Backfill candidates for existing recruitment users
-- ---------------------------------------------------------------------------

INSERT INTO public.recruitment_candidates (user_id, stage_id, stage_changed_at)
SELECT
  u.id,
  (SELECT id FROM public.recruitment_stages WHERE slug = 'new_applicant' LIMIT 1),
  COALESCE(u.created_at, NOW())
FROM public.users u
WHERE u.employee_id IS NULL
  AND (u.extern IS NOT TRUE AND COALESCE(u.extern::text, '') NOT IN ('true', 't', '1'))
  AND NOT EXISTS (
    SELECT 1 FROM public.recruitment_candidates c WHERE c.user_id = u.id
  );
