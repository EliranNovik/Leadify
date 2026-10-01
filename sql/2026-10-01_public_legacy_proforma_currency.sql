-- Public legacy proforma: stop defaulting the currency to shekels.
--
-- Two problems with the previous version of this function:
--
--   1. `COALESCE(v_ac.iso_code, 'ILS')` — when the accounting_currencies lookup missed, the client
--      received a confident-looking 'ILS' token next to a perfectly good currency_id, and the token
--      won. A USD proforma rendered as ₪. Returning NULL lets the client fall back to the id.
--
--   2. The currency came only from proformainvoice, which is a snapshot written when the proforma was
--      created. finances_paymentplanrow is the live row the payment link and the internal legacy view
--      both read, so editing the payment's currency left the public page stale. Exposing
--      payment_plan_currency_id lets the client prefer the live value, matching the other surfaces.
--
-- CREATE OR REPLACE on a function takes no heavy lock and needs no deploy.

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

  -- Prefer the live payment row's currency, falling back to the proforma's own snapshot.
  SELECT * INTO v_ac
  FROM accounting_currencies
  WHERE id = COALESCE(v_ppr.currency_id, v_pi.currency_id);

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
    'payment_plan_currency_id', v_ppr.currency_id,
    -- No COALESCE to 'ILS': an unknown currency must read as unknown so the client uses the id.
    'currency_code', v_ac.iso_code,
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
    'payment_plan_value', v_ppr.value,
    'payment_plan_vat_value', v_ppr.vat_value,
    'ppr_id', v_pi.ppr_id,
    'paymentPaid', (v_ppr.actual_date IS NOT NULL),
    'paid_at', v_ppr.actual_date
  );
END;
$$;
