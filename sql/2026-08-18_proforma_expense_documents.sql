-- Public proforma pages: list expense documents for the linked lead
-- after validating the share token. Anon can sign storage paths that
-- belong to those expense files.

CREATE OR REPLACE FUNCTION public.get_public_new_proforma_expense_documents(
  p_payment_plan_id INTEGER,
  p_public_token TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
DECLARE
  v_row public.payment_plans%ROWTYPE;
  v_proforma JSONB;
  v_lead_id UUID;
  v_docs JSONB;
BEGIN
  IF p_public_token IS NULL OR btrim(p_public_token) = '' THEN
    RETURN '[]'::JSONB;
  END IF;

  SELECT * INTO v_row
  FROM public.payment_plans
  WHERE id = p_payment_plan_id
    AND public_token = p_public_token
    AND public_token IS NOT NULL
    AND proforma IS NOT NULL;

  IF NOT FOUND THEN
    RETURN '[]'::JSONB;
  END IF;

  v_lead_id := v_row.lead_id;
  IF v_lead_id IS NULL THEN
    BEGIN
      v_proforma := v_row.proforma::JSONB;
      IF (v_proforma->>'clientId') ~ '^[0-9a-f-]{36}$' THEN
        v_lead_id := (v_proforma->>'clientId')::UUID;
      END IF;
    EXCEPTION WHEN OTHERS THEN
      v_lead_id := NULL;
    END;
  END IF;

  IF v_lead_id IS NULL THEN
    RETURN '[]'::JSONB;
  END IF;

  SELECT COALESCE(
    jsonb_agg(
      jsonb_build_object(
        'id', d.id,
        'entry_id', d.entry_id,
        'document_type', d.document_type,
        'file_name', d.file_name,
        'mime_type', d.mime_type,
        'storage_path', d.storage_path,
        'created_at', d.created_at
      )
      ORDER BY d.created_at ASC, d.id ASC
    ),
    '[]'::JSONB
  )
  INTO v_docs
  FROM public.finance_expense_documents d
  JOIN public.finance_expense_entries e ON e.id = d.entry_id
  WHERE e.new_lead_id = v_lead_id
    AND e.kind IN ('lead', 'subcontractor');

  RETURN v_docs;
END;
$$;

CREATE OR REPLACE FUNCTION public.get_public_legacy_proforma_expense_documents(
  p_proforma_id BIGINT,
  p_public_token TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
DECLARE
  v_lead_id BIGINT;
  v_docs JSONB;
BEGIN
  IF p_public_token IS NULL OR btrim(p_public_token) = '' THEN
    RETURN '[]'::JSONB;
  END IF;

  SELECT pi.lead_id
  INTO v_lead_id
  FROM public.proformainvoice pi
  WHERE pi.id = p_proforma_id
    AND pi.public_token = p_public_token
    AND pi.public_token IS NOT NULL;

  IF v_lead_id IS NULL THEN
    RETURN '[]'::JSONB;
  END IF;

  SELECT COALESCE(
    jsonb_agg(
      jsonb_build_object(
        'id', d.id,
        'entry_id', d.entry_id,
        'document_type', d.document_type,
        'file_name', d.file_name,
        'mime_type', d.mime_type,
        'storage_path', d.storage_path,
        'created_at', d.created_at
      )
      ORDER BY d.created_at ASC, d.id ASC
    ),
    '[]'::JSONB
  )
  INTO v_docs
  FROM public.finance_expense_documents d
  JOIN public.finance_expense_entries e ON e.id = d.entry_id
  WHERE e.legacy_lead_id = v_lead_id
    AND e.kind IN ('lead', 'subcontractor');

  RETURN v_docs;
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_public_new_proforma_expense_documents(INTEGER, TEXT) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_public_legacy_proforma_expense_documents(BIGINT, TEXT) TO anon, authenticated;

DROP POLICY IF EXISTS "finance-expense-documents public proforma select" ON storage.objects;
CREATE POLICY "finance-expense-documents public proforma select"
  ON storage.objects
  FOR SELECT
  TO anon
  USING (
    bucket_id = 'finance-expense-documents'
    AND EXISTS (
      SELECT 1
      FROM public.finance_expense_documents d
      WHERE d.storage_path = name
    )
  );
