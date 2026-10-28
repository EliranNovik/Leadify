-- Hide a case document or a case folder from the client portal.
--
-- Every file and folder is visible to the client by default, which is what they were before this
-- column existed. The drive can then mark one as not viewable, and the portal's Documents tab
-- stops listing it — a folder takes everything inside it along, however deeply nested.
--
-- The portal also moves onto the drive's own folders here (`public.document_folders`): until now
-- it only knew the older `lead_sub_effort_folders`, so a case filed into folders by the drive
-- looked like one flat pile to the client.
--
-- Run after sql/2026-10-21_document_folders.sql, sql/2026-10-25_nested_space_folders.sql and
-- sql/2026-10-21_document_index_view.sql. Safe to re-run.

-- 1. The flag itself ---------------------------------------------------------------------------

ALTER TABLE public.lead_case_documents
  ADD COLUMN IF NOT EXISTS client_visible boolean NOT NULL DEFAULT true;

ALTER TABLE public.document_folders
  ADD COLUMN IF NOT EXISTS client_visible boolean NOT NULL DEFAULT true;

COMMENT ON COLUMN public.lead_case_documents.client_visible IS
  'False hides this document from the client portal Documents tab. The CRM always sees it.';

COMMENT ON COLUMN public.document_folders.client_visible IS
  'False hides this folder, and everything filed anywhere under it, from the client portal.';

-- Only the hidden ones are ever looked up, and they are the rare case.
CREATE INDEX IF NOT EXISTS idx_lead_case_documents_hidden_from_client
  ON public.lead_case_documents (lead_number)
  WHERE client_visible = false;

CREATE INDEX IF NOT EXISTS idx_document_folders_hidden_from_client
  ON public.document_folders (scope_key)
  WHERE client_visible = false;

-- 2. document_index carries the flag so the drive can mark the row ------------------------------
--
-- Same view as sql/2026-10-21_document_index_view.sql with one column added at the end. The
-- stores that no client ever sees report true, which is simply "nothing to mark here".

DROP VIEW IF EXISTS public.document_index_cases;
DROP VIEW IF EXISTS public.document_index;

CREATE VIEW public.document_index AS

WITH RECURSIVE office_folder_paths AS (
  SELECT id, title AS path
  FROM public.office_document_folders
  WHERE parent_id IS NULL
  UNION ALL
  SELECT child.id, parent.path || ' / ' || child.title
  FROM public.office_document_folders child
  JOIN office_folder_paths parent ON parent.id = child.parent_id
),
personal_folder_paths AS (
  SELECT id, title AS path
  FROM public.employee_personal_folders
  WHERE parent_id IS NULL
  UNION ALL
  SELECT child.id, parent.path || ' / ' || child.title
  FROM public.employee_personal_folders child
  JOIN personal_folder_paths parent ON parent.id = child.parent_id
)

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
  d.classification_id,
  d.onedrive_subfolder              AS area,
  d.client_visible
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
  NULL::text,
  true
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
  o.folder_id,
  ofp.path,
  COALESCE('dept-' || o.department_id::text, 'admins'),
  COALESCE(NULLIF(btrim(od.name), ''), 'Admins'),
  COALESCE(o.document_type, 'Office document'),
  NULL::text,
  NULL::uuid,
  NULL::text,
  true
FROM public.office_documents o
LEFT JOIN office_folder_paths ofp ON ofp.id = o.folder_id
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
  p.folder_id,
  pfp.path,
  p.employee_id::text,
  COALESCE(NULLIF(btrim(pe.display_name), ''), 'Employee ' || p.employee_id::text),
  COALESCE(p.document_type, 'Personal file'),
  NULL::text,
  NULL::uuid,
  NULL::text,
  true
FROM public.employee_personal_files p
LEFT JOIN personal_folder_paths pfp ON pfp.id = p.folder_id
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
  NULL::text,
  true
FROM public.employee_hr_documents h
LEFT JOIN public.hr_document_types ht ON ht.id = h.document_type_id
LEFT JOIN public.tenants_employee he ON he.id = h.employee_id;

DO $$
BEGIN
  IF current_setting('server_version_num')::int >= 150000 THEN
    EXECUTE 'ALTER VIEW public.document_index SET (security_invoker = true)';
  ELSE
    RAISE WARNING 'document_index needs Postgres 15+ for security_invoker; review access before using it.';
  END IF;
END $$;

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

COMMENT ON VIEW public.document_index IS
  'Every document store the central documents page reads, in one shape. security_invoker, so each underlying table keeps its own row level security.';

GRANT SELECT ON public.document_index TO authenticated;
GRANT SELECT ON public.document_index_cases TO authenticated;

-- 3. The portal reads the drive's folders, and skips anything marked not viewable ---------------

CREATE OR REPLACE FUNCTION public.portal_get_documents(p_token UUID)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_session public.client_portal_sessions;
  v_lead_number TEXT;
  v_classifications JSONB;
  v_docs JSONB;
  v_folders JSONB;
  v_sub_effort_folders JSONB;
  v_sequence_id UUID;
  v_has_folders boolean;
BEGIN
  v_session := public._portal_session_row(p_token);
  IF v_session IS NULL THEN
    RETURN NULL;
  END IF;

  v_sequence_id := public._portal_sequence_of_events_classification_id();

  SELECT EXISTS (
    SELECT 1
    FROM information_schema.tables
    WHERE table_schema = 'public'
      AND table_name = 'lead_sub_effort_folders'
  ) INTO v_has_folders;

  IF v_session.legacy_lead_id IS NOT NULL THEN
    SELECT COALESCE(NULLIF(TRIM(ll.lead_number::TEXT), ''), ll.id::TEXT)
    INTO v_lead_number
    FROM public.leads_lead ll
    WHERE ll.id = v_session.legacy_lead_id;
  ELSE
    SELECT COALESCE(NULLIF(TRIM(l.lead_number::TEXT), ''), NULLIF(TRIM(l.manual_id::TEXT), ''), l.id::TEXT)
    INTO v_lead_number
    FROM public.leads l
    WHERE l.id = v_session.new_lead_id;
  END IF;

  SELECT COALESCE(
    jsonb_agg(
      jsonb_build_object(
        'id', c.id,
        'slug', c.slug,
        'label', c.label,
        'sort_order', c.sort_order
      )
      ORDER BY
        CASE
          WHEN c.slug IN ('sequence_of_events', 'sequence-of-events') THEN 1
          WHEN c.slug = 'expert' THEN 2
          WHEN c.slug IN ('legal_claims', 'legal-claims') THEN 3
          WHEN c.slug = 'contract' THEN 4
          ELSE 100 + c.sort_order
        END,
        c.sort_order
    ),
    '[]'::JSONB
  )
  INTO v_classifications
  FROM public._portal_visible_document_classifications() c;

  -- The drive's own folder tree for this case, minus anything marked not viewable. A hidden
  -- folder hides its children too, so the whole branch is walked rather than one level.
  WITH RECURSIVE portal_cats AS (
    SELECT pvc.id FROM public._portal_visible_document_classifications() pvc
  ),
  hidden AS (
    SELECT df.id
    FROM public.document_folders df
    WHERE df.scope_type = 'lead'
      AND df.scope_key = v_lead_number
      AND df.client_visible = false
    UNION
    SELECT child.id
    FROM public.document_folders child
    JOIN hidden h ON h.id = child.parent_id
  ),
  visible AS (
    SELECT df.*
    FROM public.document_folders df
    WHERE df.scope_type = 'lead'
      AND df.scope_key = v_lead_number
      AND df.id NOT IN (SELECT id FROM hidden)
      AND (
        df.classification_id IS NULL
        OR df.classification_id IN (SELECT pc.id FROM portal_cats pc)
      )
      AND (df.area IS NULL OR df.area NOT ILIKE '%internal%')
  )
  SELECT COALESCE(
    jsonb_agg(
      jsonb_build_object(
        'id', v.id::TEXT,
        'title', v.title,
        'note', v.note,
        'parent_id', v.parent_id::TEXT,
        'sort_order', v.sort_order,
        'created_at', v.created_at,
        'created_by', v.created_by,
        'lead_sub_effort_id', NULL,
        'sub_effort_name', NULL,
        'classification_id', COALESCE(v.classification_id, v_sequence_id),
        'classification_slug', cls.slug,
        'classification_label', cls.label
      )
      ORDER BY v.depth ASC, v.sort_order ASC, v.title ASC
    ),
    '[]'::JSONB
  )
  INTO v_folders
  FROM visible v
  LEFT JOIN public.case_document_classifications cls
    ON cls.id = COALESCE(v.classification_id, v_sequence_id);

  -- Sub-effort folders, which hold the documents attached to a sub-effort rather than filed.
  IF v_has_folders THEN
    WITH portal_cats AS (
      SELECT pvc.id FROM public._portal_visible_document_classifications() pvc
    )
    SELECT COALESCE(
      jsonb_agg(
        jsonb_build_object(
          'id', f.id,
          'title', f.title,
          'note', f.note,
          'parent_id', NULL,
          'sort_order', f.sort_order,
          'created_at', f.created_at,
          'created_by', f.created_by,
          'lead_sub_effort_id', f.lead_sub_effort_id,
          'sub_effort_name', se.name,
          'classification_id', se.case_document_classification_id,
          'classification_slug', cls.slug,
          'classification_label', cls.label
        )
        ORDER BY f.sort_order ASC, f.created_at ASC, f.title ASC
      ),
      '[]'::JSONB
    )
    INTO v_sub_effort_folders
    FROM public.lead_sub_effort_folders f
    INNER JOIN public.lead_sub_efforts lse ON lse.id = f.lead_sub_effort_id
    INNER JOIN public.sub_efforts se ON se.id = lse.sub_effort_id
    INNER JOIN public.case_document_classifications cls
      ON cls.id = se.case_document_classification_id
    WHERE lse.internal = FALSE
      AND se.case_document_classification_id IN (SELECT pc.id FROM portal_cats pc)
      AND (
        (v_session.legacy_lead_id IS NOT NULL AND lse.legacy_lead_id::TEXT = v_session.legacy_lead_id::TEXT)
        OR (v_session.new_lead_id IS NOT NULL AND lse.new_lead_id::TEXT = v_session.new_lead_id::TEXT)
      );
  ELSE
    v_sub_effort_folders := '[]'::JSONB;
  END IF;

  v_folders := COALESCE(v_folders, '[]'::JSONB) || COALESCE(v_sub_effort_folders, '[]'::JSONB);

  WITH RECURSIVE portal_cats AS (
    SELECT pvc.id FROM public._portal_visible_document_classifications() pvc
  ),
  hidden AS (
    SELECT df.id
    FROM public.document_folders df
    WHERE df.scope_type = 'lead'
      AND df.scope_key = v_lead_number
      AND df.client_visible = false
    UNION
    SELECT child.id
    FROM public.document_folders child
    JOIN hidden h ON h.id = child.parent_id
  ),
  case_docs AS (
    SELECT
      d.id::TEXT AS id,
      d.file_name,
      d.storage_path,
      NULL::TEXT AS download_url,
      d.mime_type,
      d.file_size,
      d.created_at,
      d.uploaded_by,
      COALESCE(d.classification_id, v_sequence_id) AS classification_id,
      cls.slug AS classification_slug,
      cls.label AS classification_label,
      d.contact_id,
      d.document_type_id,
      dt.name AS document_type_name,
      lc.name AS contact_name,
      'case'::TEXT AS source,
      d.folder_id::TEXT AS folder_id,
      NULL::BIGINT AS lead_sub_effort_id,
      NULL::TEXT AS sub_effort_name
    FROM public.lead_case_documents d
    LEFT JOIN public.case_document_classifications cls
      ON cls.id = COALESCE(d.classification_id, v_sequence_id)
    LEFT JOIN public.lead_case_document_types dt ON dt.id = d.document_type_id
    LEFT JOIN public.leads_contact lc ON lc.id = d.contact_id
    WHERE d.lead_number = v_lead_number
      AND d.storage_path IS NOT NULL
      AND (d.onedrive_subfolder IS NULL OR d.onedrive_subfolder NOT ILIKE '%internal%')
      AND COALESCE(d.classification_id, v_sequence_id) IN (SELECT pc.id FROM portal_cats pc)
      -- Marked not viewable, or filed in a folder that is.
      AND d.client_visible IS NOT FALSE
      AND (d.folder_id IS NULL OR d.folder_id NOT IN (SELECT id FROM hidden))
  ),
  subeffort_docs AS (
    SELECT
      format('subeffort-%s-%s', lse.id, t.ordinality)::TEXT AS id,
      COALESCE(
        NULLIF(trim(t.doc_item->>'name'), ''),
        NULLIF(trim(regexp_replace(COALESCE(t.doc_item->>'path', t.doc_item->>'url', ''), '^.*/', '')), ''),
        'Document'
      ) AS file_name,
      NULLIF(trim(t.doc_item->>'path'), '') AS storage_path,
      NULLIF(trim(t.doc_item->>'url'), '') AS download_url,
      COALESCE(NULLIF(trim(t.doc_item->>'mimeType'), ''), 'application/octet-stream') AS mime_type,
      NULL::BIGINT AS file_size,
      COALESCE(lse.created_at, NOW()) AS created_at,
      COALESCE(NULLIF(trim(lse.updated_by), ''), NULLIF(trim(lse.created_by), '')) AS uploaded_by,
      se.case_document_classification_id AS classification_id,
      cls.slug AS classification_slug,
      cls.label AS classification_label,
      NULL::BIGINT AS contact_id,
      NULL::UUID AS document_type_id,
      NULL::TEXT AS document_type_name,
      NULL::TEXT AS contact_name,
      'subeffort'::TEXT AS source,
      NULLIF(trim(t.doc_item->>'folder_id'), '') AS folder_id,
      lse.id AS lead_sub_effort_id,
      se.name AS sub_effort_name
    FROM public.lead_sub_efforts lse
    INNER JOIN public.sub_efforts se ON se.id = lse.sub_effort_id
    INNER JOIN public.case_document_classifications cls
      ON cls.id = se.case_document_classification_id
    CROSS JOIN LATERAL jsonb_array_elements(
      CASE jsonb_typeof(lse.document_url)
        WHEN 'array' THEN lse.document_url
        WHEN 'string' THEN jsonb_build_array(jsonb_build_object('url', lse.document_url))
        WHEN 'object' THEN jsonb_build_array(lse.document_url)
        ELSE '[]'::JSONB
      END
    ) WITH ORDINALITY AS t(doc_item, ordinality)
    WHERE se.case_document_classification_id IN (SELECT pc.id FROM portal_cats pc)
      AND lse.internal = FALSE
      AND (
        NULLIF(trim(t.doc_item->>'path'), '') IS NOT NULL
        OR NULLIF(trim(t.doc_item->>'url'), '') IS NOT NULL
      )
      AND (
        (v_session.legacy_lead_id IS NOT NULL AND lse.legacy_lead_id::TEXT = v_session.legacy_lead_id::TEXT)
        OR (v_session.new_lead_id IS NOT NULL AND lse.new_lead_id::TEXT = v_session.new_lead_id::TEXT)
      )
  ),
  combined AS (
    SELECT * FROM case_docs
    UNION ALL
    SELECT * FROM subeffort_docs
  )
  SELECT COALESCE(jsonb_agg(row_to_json(c)::JSONB ORDER BY c.created_at DESC), '[]'::JSONB)
  INTO v_docs
  FROM combined c;

  RETURN jsonb_build_object(
    'classifications', v_classifications,
    'folders', COALESCE(v_folders, '[]'::JSONB),
    'documents', v_docs,
    'lead_number', v_lead_number
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.portal_get_documents(UUID) TO anon, authenticated;

NOTIFY pgrst, 'reload schema';
