-- Per-contact document types for lead_case_documents (CRM Documents tab + client portal uploads).
-- Run in Supabase SQL editor.

CREATE TABLE IF NOT EXISTS public.lead_case_document_types (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  sort_order INT NOT NULL DEFAULT 0,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_lead_case_document_types_name_lower
  ON public.lead_case_document_types (lower(trim(name)));

ALTER TABLE public.lead_case_document_types ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS lead_case_document_types_authenticated_select ON public.lead_case_document_types;
CREATE POLICY lead_case_document_types_authenticated_select ON public.lead_case_document_types
  FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS lead_case_document_types_authenticated_all ON public.lead_case_document_types;
CREATE POLICY lead_case_document_types_authenticated_all ON public.lead_case_document_types
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

INSERT INTO public.lead_case_document_types (name, sort_order)
SELECT v.name, v.sort_order
FROM (
  VALUES
    ('Birth Certificate', 10),
    ('Marriage Certificate', 20),
    ('Passport Copy', 30),
    ('Police Certificate', 40),
    ('ID Card Copy', 50),
    ('Proof of Address', 60),
    ('Other', 999)
) AS v(name, sort_order)
WHERE NOT EXISTS (
  SELECT 1 FROM public.lead_case_document_types t WHERE lower(trim(t.name)) = lower(trim(v.name))
);

ALTER TABLE public.lead_case_documents
  ADD COLUMN IF NOT EXISTS contact_id BIGINT NULL REFERENCES public.leads_contact(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS document_type_id UUID NULL REFERENCES public.lead_case_document_types(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_lead_case_documents_contact_id
  ON public.lead_case_documents(contact_id) WHERE contact_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_lead_case_documents_document_type_id
  ON public.lead_case_documents(document_type_id) WHERE document_type_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_lead_case_documents_lead_contact_type
  ON public.lead_case_documents(lead_number, contact_id, document_type_id);

ALTER TABLE public.client_portal_upload_tokens
  ADD COLUMN IF NOT EXISTS contact_id BIGINT NULL,
  ADD COLUMN IF NOT EXISTS document_type_id UUID NULL;

CREATE OR REPLACE FUNCTION public.portal_get_lead_case_document_types(p_token UUID)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_session public.client_portal_sessions;
  v_lead_number TEXT;
BEGIN
  v_session := public._portal_session_row(p_token);
  IF v_session IS NULL THEN
    RETURN NULL;
  END IF;

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

  RETURN jsonb_build_object(
    'types',
    COALESCE(
      (
        SELECT jsonb_agg(
          jsonb_build_object(
            'id', t.id,
            'name', t.name,
            'sort_order', a.sort_order
          )
          ORDER BY a.sort_order, t.name
        )
        FROM public.lead_case_document_type_assignments a
        INNER JOIN public.lead_case_document_types t
          ON t.id = a.document_type_id
         AND t.active = TRUE
        WHERE a.lead_number = v_lead_number
      ),
      '[]'::JSONB
    ),
    'lead_number', v_lead_number
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.portal_prepare_document_upload(
  p_token UUID,
  p_file_name TEXT,
  p_mime_type TEXT DEFAULT NULL,
  p_file_size BIGINT DEFAULT NULL,
  p_contact_id BIGINT DEFAULT NULL,
  p_document_type_id UUID DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_session public.client_portal_sessions;
  v_lead_number TEXT;
  v_safe_name TEXT;
  v_storage_path TEXT;
  v_upload_id BIGINT;
  v_contact_id BIGINT;
  v_document_type_id UUID;
BEGIN
  v_session := public._portal_session_row(p_token);
  IF v_session IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Session expired');
  END IF;

  IF p_file_name IS NULL OR trim(p_file_name) = '' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'File name required');
  END IF;

  v_contact_id := COALESCE(p_contact_id, v_session.contact_id);
  IF v_contact_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Contact is required');
  END IF;

  IF p_document_type_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Document type is required');
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.lead_case_document_types t
    WHERE t.id = p_document_type_id AND t.active = TRUE
  ) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Invalid document type');
  END IF;

  IF v_session.legacy_lead_id IS NOT NULL THEN
    IF NOT EXISTS (
      SELECT 1
      FROM public.lead_leadcontact llc
      WHERE llc.lead_id::TEXT = v_session.legacy_lead_id::TEXT
        AND llc.contact_id::TEXT = v_contact_id::TEXT
    ) THEN
      RETURN jsonb_build_object('ok', false, 'error', 'Contact does not belong to this case');
    END IF;
  ELSE
    IF NOT EXISTS (
      SELECT 1
      FROM public.lead_leadcontact llc
      WHERE llc.newlead_id::TEXT = v_session.new_lead_id::TEXT
        AND llc.contact_id::TEXT = v_contact_id::TEXT
    ) AND NOT EXISTS (
      SELECT 1
      FROM public.leads_contact lc
      WHERE lc.id = v_contact_id
        AND lc.newlead_id::TEXT = v_session.new_lead_id::TEXT
    ) THEN
      RETURN jsonb_build_object('ok', false, 'error', 'Contact does not belong to this case');
    END IF;
  END IF;

  v_document_type_id := p_document_type_id;

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

  v_safe_name := regexp_replace(trim(p_file_name), '[^\w.\-()+ ]', '_', 'g');
  v_storage_path := format(
    'case-documents/%s/portal-client/%s_%s',
    v_lead_number,
    extract(epoch from now())::BIGINT,
    v_safe_name
  );

  INSERT INTO public.client_portal_upload_tokens (
    session_id,
    storage_path,
    file_name,
    mime_type,
    file_size,
    expires_at,
    contact_id,
    document_type_id
  ) VALUES (
    v_session.id,
    v_storage_path,
    trim(p_file_name),
    p_mime_type,
    p_file_size,
    NOW() + INTERVAL '1 hour',
    v_contact_id,
    v_document_type_id
  )
  RETURNING id INTO v_upload_id;

  RETURN jsonb_build_object(
    'ok', true,
    'upload_id', v_upload_id,
    'storage_path', v_storage_path,
    'lead_number', v_lead_number,
    'bucket', 'lead-sub-efforts-documents',
    'contact_id', v_contact_id,
    'document_type_id', v_document_type_id
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.portal_finalize_document_upload(
  p_token UUID,
  p_storage_path TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_session public.client_portal_sessions;
  v_token_row public.client_portal_upload_tokens;
  v_doc_id UUID;
  v_lead_number TEXT;
  v_classification_id UUID;
  v_uploaded_by TEXT;
BEGIN
  v_session := public._portal_session_row(p_token);
  IF v_session IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Session expired');
  END IF;

  SELECT * INTO v_token_row
  FROM public.client_portal_upload_tokens t
  WHERE t.session_id = v_session.id
    AND t.storage_path = p_storage_path
    AND t.used = FALSE
    AND t.expires_at > NOW()
  LIMIT 1;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Invalid upload token');
  END IF;

  IF v_token_row.contact_id IS NULL OR v_token_row.document_type_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Contact and document type are required');
  END IF;

  v_classification_id := public._portal_sequence_of_events_classification_id();

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

  SELECT COALESCE(NULLIF(TRIM(lc.name), ''), 'Portal client')
  INTO v_uploaded_by
  FROM public.leads_contact lc
  WHERE lc.id = v_token_row.contact_id;

  INSERT INTO public.lead_case_documents (
    lead_number,
    onedrive_subfolder,
    onedrive_item_id,
    storage_path,
    file_name,
    file_size,
    mime_type,
    classification_id,
    uploaded_by,
    ai_summary_status,
    contact_id,
    document_type_id
  ) VALUES (
    v_lead_number,
    NULL,
    NULL,
    v_token_row.storage_path,
    v_token_row.file_name,
    v_token_row.file_size,
    COALESCE(v_token_row.mime_type, 'application/octet-stream'),
    v_classification_id,
    v_uploaded_by,
    'pending',
    v_token_row.contact_id,
    v_token_row.document_type_id
  )
  RETURNING id INTO v_doc_id;

  UPDATE public.client_portal_upload_tokens
  SET used = TRUE
  WHERE id = v_token_row.id;

  RETURN jsonb_build_object('ok', true, 'document_id', v_doc_id);
END;
$$;

GRANT EXECUTE ON FUNCTION public.portal_get_lead_case_document_types(UUID) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.portal_prepare_document_upload(UUID, TEXT, TEXT, BIGINT, BIGINT, UUID) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.portal_finalize_document_upload(UUID, TEXT) TO anon, authenticated;
GRANT SELECT ON public.lead_case_document_types TO authenticated;

-- Extend portal_get_documents to return contact + document type metadata.
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
      d.contact_id,
      d.document_type_id,
      dt.name AS document_type_name,
      lc.name AS contact_name,
      'case'::TEXT AS source
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

GRANT EXECUTE ON FUNCTION public.portal_get_documents(UUID) TO anon, authenticated;
