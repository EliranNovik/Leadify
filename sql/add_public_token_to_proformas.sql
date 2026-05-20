-- Public share links for proforma invoices (new payment_plans + legacy proformainvoice).
-- Clients open /public-proforma/:id/:token or /public-proforma-legacy/:id/:token without signing in.

ALTER TABLE public.payment_plans
  ADD COLUMN IF NOT EXISTS public_token TEXT;

ALTER TABLE public.proformainvoice
  ADD COLUMN IF NOT EXISTS public_token TEXT;

CREATE INDEX IF NOT EXISTS idx_payment_plans_public_token
  ON public.payment_plans (public_token)
  WHERE public_token IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_proformainvoice_public_token
  ON public.proformainvoice (public_token)
  WHERE public_token IS NOT NULL;

COMMENT ON COLUMN public.payment_plans.public_token IS 'UUID token for anonymous read-only proforma share URL';
COMMENT ON COLUMN public.proformainvoice.public_token IS 'UUID token for anonymous read-only proforma share URL';

-- New-lead proforma (payment_plans.proforma JSON)
CREATE OR REPLACE FUNCTION public.get_public_new_proforma(
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
  v_row payment_plans%ROWTYPE;
  v_proforma JSONB;
  v_lead_number TEXT;
BEGIN
  SELECT * INTO v_row
  FROM payment_plans
  WHERE id = p_payment_plan_id
    AND public_token = p_public_token
    AND public_token IS NOT NULL
    AND proforma IS NOT NULL;

  IF NOT FOUND THEN
    RETURN NULL;
  END IF;

  BEGIN
    v_proforma := v_row.proforma::JSONB;
  EXCEPTION WHEN OTHERS THEN
    v_proforma := to_jsonb(v_row.proforma::TEXT);
  END;

  IF v_row.lead_id IS NOT NULL THEN
    SELECT COALESCE(
      NULLIF(TRIM(l.lead_number::TEXT), ''),
      NULLIF(TRIM(l.manual_id::TEXT), ''),
      v_row.lead_id::TEXT
    )
    INTO v_lead_number
    FROM public.leads l
    WHERE l.id = v_row.lead_id;
  ELSIF v_proforma ? 'clientId' AND (v_proforma->>'clientId') ~ '^[0-9a-f-]{36}$' THEN
    SELECT COALESCE(
      NULLIF(TRIM(l.lead_number::TEXT), ''),
      NULLIF(TRIM(l.manual_id::TEXT), ''),
      (v_proforma->>'clientId')
    )
    INTO v_lead_number
    FROM public.leads l
    WHERE l.id = (v_proforma->>'clientId')::UUID;
  END IF;

  RETURN jsonb_build_object(
    'proforma', v_proforma,
    'paid', COALESCE(v_row.paid, FALSE),
    'paid_at', v_row.paid_at,
    'currency', v_row.currency,
    'currency_id', v_row.currency_id,
    'client_id', v_row.client_id,
    'lead_id', v_row.lead_id,
    'lead_number', v_lead_number,
    'value_vat', v_row.value_vat,
    'payment_order', v_row.payment_order,
    'due_date', v_row.due_date
  );
END;
$$;

-- Legacy proforma (proformainvoice + rows + payment row for paid date)
CREATE OR REPLACE FUNCTION public.get_public_legacy_proforma(
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
  v_pi proformainvoice%ROWTYPE;
  v_rows JSONB;
  v_ppr finances_paymentplanrow%ROWTYPE;
  v_ac accounting_currencies%ROWTYPE;
  v_lead leads_lead%ROWTYPE;
  v_contact leads_contact%ROWTYPE;
  v_contact_id BIGINT;
  v_employee_name TEXT;
  v_client_name TEXT;
  v_client_email TEXT;
  v_client_phone TEXT;
BEGIN
  SELECT * INTO v_pi
  FROM proformainvoice
  WHERE id = p_proforma_id
    AND public_token = p_public_token
    AND public_token IS NOT NULL;

  IF NOT FOUND THEN
    RETURN NULL;
  END IF;

  SELECT COALESCE(
    jsonb_agg(
      jsonb_build_object(
        'id', pir.id,
        'description', pir.description,
        'qty', pir.qty,
        'rate', pir.rate,
        'total', pir.total
      ) ORDER BY pir.id
    ),
    '[]'::JSONB
  ) INTO v_rows
  FROM proformainvoicerow pir
  WHERE pir.invoice_id = v_pi.id;

  SELECT * INTO v_ac FROM accounting_currencies WHERE id = v_pi.currency_id;

  IF v_pi.ppr_id IS NOT NULL THEN
    SELECT * INTO v_ppr FROM finances_paymentplanrow WHERE id = v_pi.ppr_id;
    IF FOUND AND v_ppr.client_id IS NOT NULL THEN
      SELECT * INTO v_contact FROM leads_contact WHERE id = v_ppr.client_id;
      IF FOUND THEN
        v_client_name := v_contact.name;
        v_client_email := v_contact.email;
        v_client_phone := v_contact.phone;
      END IF;
    END IF;
  END IF;

  IF v_pi.lead_id IS NOT NULL THEN
    SELECT * INTO v_lead FROM leads_lead WHERE id = v_pi.lead_id;
  END IF;

  IF v_client_name IS NULL AND v_pi.lead_id IS NOT NULL THEN
    SELECT llc.contact_id INTO v_contact_id
    FROM lead_leadcontact llc
    WHERE llc.lead_id = v_pi.lead_id
    ORDER BY
      CASE
        WHEN llc.main IN ('true', 't', '1') OR llc.main IS TRUE THEN 0
        ELSE 1
      END,
      llc.contact_id
    LIMIT 1;

    IF v_contact_id IS NOT NULL THEN
      SELECT * INTO v_contact FROM leads_contact WHERE id = v_contact_id;
      IF FOUND THEN
        v_client_name := v_contact.name;
        v_client_email := v_contact.email;
        v_client_phone := v_contact.phone;
      END IF;
    END IF;
  END IF;

  IF v_pi.creator_id IS NOT NULL THEN
    SELECT te.display_name INTO v_employee_name
    FROM tenants_employee te
    WHERE te.id = v_pi.creator_id;
  END IF;

  RETURN jsonb_build_object(
    'id', v_pi.id,
    'cdate', v_pi.cdate,
    'total', v_pi.total,
    'total_base', v_pi.total_base,
    'vat_value', v_pi.vat_value,
    'sub_total', v_pi.sub_total,
    'add_vat', v_pi.add_vat,
    'currency_id', v_pi.currency_id,
    'currency_code', COALESCE(v_ac.iso_code, 'ILS'),
    'currency_name', v_ac.name,
    'lead_id', v_pi.lead_id,
    'lead_number', COALESCE(v_lead.manual_id::TEXT, v_pi.lead_id::TEXT),
    'client_name', COALESCE(v_client_name, v_lead.name, 'Client'),
    'client_email', COALESCE(v_client_email, v_lead.email, ''),
    'client_phone', COALESCE(v_client_phone, v_lead.phone, ''),
    'notes', v_pi.notes,
    'bank_account_id', v_pi.bank_account_id,
    'rows', v_rows,
    'issuedBy', v_employee_name,
    'issuer_employee_id', v_pi.creator_id,
    'issuedDate', v_pi.cdate,
    'paymentPlanDate', COALESCE(v_ppr.date, v_ppr.due_date),
    'payment_order', v_ppr."order",
    'payment_plan_vat_value', v_ppr.vat_value,
    'ppr_id', v_pi.ppr_id,
    'paymentPaid', (v_ppr.actual_date IS NOT NULL),
    'paid_at', v_ppr.actual_date
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_public_new_proforma(INTEGER, TEXT) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_public_legacy_proforma(BIGINT, TEXT) TO anon, authenticated;

-- Exchange rates on public unpaid/paid proformas
GRANT EXECUTE ON FUNCTION public.get_boi_exchange_rates_for_date(DATE) TO anon;
GRANT SELECT ON public.currency_rates TO anon;
