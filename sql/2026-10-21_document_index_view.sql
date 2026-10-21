-- One read for the central documents page: case documents, staff meeting documents, office
-- documents, employee personal files and HR files in a single shape so the page can search,
-- sort, filter and page through them with one query.
--
-- The view is security_invoker, so each table's own policies still decide what a person sees:
-- office documents stay superuser-only, HR and personal files stay with their owner, and case
-- documents follow the folder permissions in sql/2026-10-21_document_folders.sql. Without that
-- setting a view runs as its owner and would hand everyone everything.
--
-- Run sql/2026-10-21_document_folders.sql first (this reads lead_case_documents.folder_id).
-- Safe to re-run.

-- The page orders by date across every store, and this is by far the biggest one.
CREATE INDEX IF NOT EXISTS idx_lead_case_documents_created_at
  ON public.lead_case_documents (created_at DESC);

DROP VIEW IF EXISTS public.document_index;

CREATE VIEW public.document_index AS

-- Case documents on a lead.
SELECT
  'lead'::text                      AS source,
  d.id::text                        AS row_id,
  d.file_name,
  'lead-sub-efforts-documents'::text AS storage_bucket,
  d.storage_path,
  d.mime_type,
  d.file_size,
  d.uploaded_by,
  d.created_at,
  d.folder_id,
  f.path                            AS folder_path,
  d.lead_number                     AS scope_key,
  d.lead_number                     AS scope_label,
  c.label                           AS category,
  d.ai_summary,
  -- The folder tree is keyed by these, so the page needs them to offer a move.
  d.classification_id,
  d.onedrive_subfolder              AS area
FROM public.lead_case_documents d
LEFT JOIN public.document_folders f ON f.id = d.folder_id
LEFT JOIN public.case_document_classifications c ON c.id = d.classification_id
WHERE d.storage_path IS NOT NULL

UNION ALL

-- Documents on an internal staff meeting.
SELECT
  'staff_meeting'::text,
  s.id::text,
  s.file_name,
  'lead-sub-efforts-documents'::text,
  s.storage_path,
  s.mime_type,
  s.file_size,
  s.uploaded_by,
  s.created_at,
  NULL::uuid,
  NULL::text,
  s.meeting_id::text,
  COALESCE(NULLIF(btrim(m.meeting_subject), ''), 'Internal meeting'),
  'Meeting'::text,
  s.ai_summary,
  NULL::uuid,
  NULL::text
FROM public.staff_meeting_documents s
LEFT JOIN public.meetings m ON m.id = s.meeting_id

UNION ALL

-- Office / organisation documents. One space per department, plus the admin space.
SELECT
  'office'::text,
  o.id::text,
  o.file_name,
  'office-documents'::text,
  o.storage_path,
  o.mime_type,
  o.size_bytes,
  o.created_by::text,
  o.created_at,
  NULL::uuid,
  ofo.title,
  COALESCE('dept-' || o.department_id::text, 'admins'),
  COALESCE(NULLIF(btrim(od.name), ''), 'Admins'),
  COALESCE(o.document_type, 'Office document'),
  NULL::text,
  NULL::uuid,
  NULL::text
FROM public.office_documents o
LEFT JOIN public.office_document_folders ofo ON ofo.id = o.folder_id
LEFT JOIN public.tenant_departement od ON od.id = o.department_id

UNION ALL

-- An employee's own space.
SELECT
  'personal'::text,
  p.id::text,
  p.file_name,
  'employee-personal-files'::text,
  p.storage_path,
  p.mime_type,
  p.size_bytes,
  NULL::text,
  p.created_at,
  NULL::uuid,
  pfo.title,
  p.employee_id::text,
  COALESCE(NULLIF(btrim(pe.display_name), ''), 'Employee ' || p.employee_id::text),
  COALESCE(p.document_type, 'Personal file'),
  NULL::text,
  NULL::uuid,
  NULL::text
FROM public.employee_personal_files p
LEFT JOIN public.employee_personal_folders pfo ON pfo.id = p.folder_id
LEFT JOIN public.tenants_employee pe ON pe.id = p.employee_id

UNION ALL

-- HR file cabinet. No size is stored for these.
SELECT
  'hr'::text,
  h.id::text,
  h.file_name,
  'employee-hr-documents'::text,
  h.storage_path,
  h.mime_type,
  NULL::bigint,
  h.uploaded_by::text,
  h.created_at,
  NULL::uuid,
  NULL::text,
  h.employee_id::text,
  COALESCE(NULLIF(btrim(he.display_name), ''), 'Employee ' || h.employee_id::text),
  COALESCE(ht.label, 'HR document'),
  NULL::text,
  NULL::uuid,
  NULL::text
FROM public.employee_hr_documents h
LEFT JOIN public.hr_document_types ht ON ht.id = h.document_type_id
LEFT JOIN public.tenants_employee he ON he.id = h.employee_id;

-- Postgres 15 and up. Without this the view would run with the owner's rights and leak every
-- table it reads.
DO $$
BEGIN
  IF current_setting('server_version_num')::int >= 150000 THEN
    EXECUTE 'ALTER VIEW public.document_index SET (security_invoker = true)';
  ELSE
    RAISE WARNING 'document_index needs Postgres 15+ for security_invoker; review access before using it.';
  END IF;
END $$;

-- The Cases section browses one case at a time, so it needs the list of cases that actually hold
-- documents. Reads document_index, so each person only counts files they may see.
DROP VIEW IF EXISTS public.document_index_cases;

CREATE VIEW public.document_index_cases AS
SELECT
  scope_key          AS lead_number,
  count(*)::bigint   AS file_count,
  max(created_at)    AS last_added
FROM public.document_index
WHERE source = 'lead' AND scope_key IS NOT NULL
GROUP BY scope_key;

DO $$
BEGIN
  IF current_setting('server_version_num')::int >= 150000 THEN
    EXECUTE 'ALTER VIEW public.document_index_cases SET (security_invoker = true)';
  END IF;
END $$;

GRANT SELECT ON public.document_index_cases TO authenticated;

COMMENT ON VIEW public.document_index IS
  'Every document store the central documents page reads, in one shape. security_invoker, so each underlying table keeps its own row level security.';

GRANT SELECT ON public.document_index TO authenticated;

NOTIFY pgrst, 'reload schema';
