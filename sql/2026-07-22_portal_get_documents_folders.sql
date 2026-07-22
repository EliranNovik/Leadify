-- Portal documents: return employee-created sub-effort folders + folder_id on documents.
-- Run in Supabase SQL editor (after lead_sub_effort_folders + portal_get_documents contact/type migrations).

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
    INTO v_folders
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
    v_folders := '[]'::JSONB;
  END IF;

  WITH portal_cats AS (
    SELECT pvc.id FROM public._portal_visible_document_classifications() pvc
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
      NULL::TEXT AS folder_id,
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
