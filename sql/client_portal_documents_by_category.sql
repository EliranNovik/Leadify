-- Portal documents: return staff categories + documents grouped by classification.

CREATE OR REPLACE FUNCTION public._portal_visible_document_classifications()
RETURNS TABLE (
  id UUID,
  slug TEXT,
  label TEXT,
  sort_order INT
)
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  SELECT
    c.id,
    c.slug,
    c.label,
    c.sort_order
  FROM public.case_document_classifications c
  WHERE c.is_active = TRUE
    AND (
      c.slug IN (
        'sequence_of_events',
        'sequence-of-events',
        'legal_claims',
        'legal-claims',
        'expert',
        'contract'
      )
      OR lower(trim(c.label)) IN (
        lower('Sequence of Events'),
        lower('Legal claims'),
        lower('Expert'),
        lower('Contract')
      )
    )
  ORDER BY
    CASE
      WHEN c.slug IN ('sequence_of_events', 'sequence-of-events') THEN 1
      WHEN c.slug = 'expert' THEN 2
      WHEN c.slug IN ('legal_claims', 'legal-claims') THEN 3
      WHEN c.slug = 'contract' THEN 4
      ELSE 100 + c.sort_order
    END,
    c.sort_order;
$$;

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
  v_sequence_id UUID;
BEGIN
  v_session := public._portal_session_row(p_token);
  IF v_session IS NULL THEN
    RETURN NULL;
  END IF;

  v_sequence_id := public._portal_sequence_of_events_classification_id();

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
      'case'::TEXT AS source
    FROM public.lead_case_documents d
    LEFT JOIN public.case_document_classifications cls
      ON cls.id = COALESCE(d.classification_id, v_sequence_id)
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
      'subeffort'::TEXT AS source
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
    'documents', v_docs,
    'lead_number', v_lead_number
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public._portal_visible_document_classifications() TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.portal_get_documents(UUID) TO anon, authenticated;
