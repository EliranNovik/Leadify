-- Public proforma pages: only return expense documents attached to this
-- payment row (lead_expenses.payment_plan_id / legacy_payment_plan_row_id),
-- not every expense on the lead.

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
  JOIN public.lead_expenses le
    ON e.destination_table = 'lead_expenses'
   AND e.destination_id = le.id::text
  WHERE le.payment_plan_id = p_payment_plan_id
    AND e.kind = 'lead';

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
  v_ppr_id BIGINT;
  v_docs JSONB;
BEGIN
  IF p_public_token IS NULL OR btrim(p_public_token) = '' THEN
    RETURN '[]'::JSONB;
  END IF;

  SELECT pi.ppr_id
  INTO v_ppr_id
  FROM public.proformainvoice pi
  WHERE pi.id = p_proforma_id
    AND pi.public_token = p_public_token
    AND pi.public_token IS NOT NULL;

  IF v_ppr_id IS NULL THEN
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
  JOIN public.lead_expenses le
    ON e.destination_table = 'lead_expenses'
   AND e.destination_id = le.id::text
  WHERE le.legacy_payment_plan_row_id = v_ppr_id
    AND e.kind = 'lead';

  RETURN v_docs;
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_public_new_proforma_expense_documents(INTEGER, TEXT) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_public_legacy_proforma_expense_documents(BIGINT, TEXT) TO anon, authenticated;
