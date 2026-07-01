-- Portal finances: ensure public invoice tokens for rows with proformas; tax receipts; legacy proforma links.

CREATE OR REPLACE FUNCTION public.portal_get_finances(p_token UUID)
RETURNS JSONB
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_session public.client_portal_sessions;
  v_payments JSONB;
  v_proformas JSONB;
BEGIN
  v_session := public._portal_session_row(p_token);
  IF v_session IS NULL THEN
    RETURN NULL;
  END IF;

  IF v_session.legacy_lead_id IS NOT NULL THEN
    -- Legacy proformas: create share tokens when missing so portal can link invoices.
    UPDATE public.proformainvoice pi
    SET public_token = gen_random_uuid()::TEXT
    FROM public.finances_paymentplanrow fpr
    WHERE pi.ppr_id = fpr.id
      AND fpr.lead_id::TEXT = v_session.legacy_lead_id::TEXT
      AND fpr.cancel_date IS NULL
      AND pi.lead_id::TEXT = v_session.legacy_lead_id::TEXT
      AND (pi.public_token IS NULL OR TRIM(pi.public_token) = '');

    SELECT COALESCE(jsonb_agg(row_to_json(t)::JSONB ORDER BY t.due_date NULLS LAST, t.id), '[]'::JSONB)
    INTO v_payments
    FROM (
      SELECT
        fpr.id,
        fpr.date AS due_date,
        fpr.value,
        fpr.vat_value AS value_vat,
        (fpr.actual_date IS NOT NULL) AS paid,
        fpr.actual_date AS paid_at,
        fpr.client_id AS plan_contact_id,
        ac.name AS currency,
        pl.secure_token,
        pl.status AS link_status,
        pl.expires_at AS link_expires_at,
        TRUE AS is_legacy,
        pi_link.public_token,
        pi_link.proforma_id,
        (pi_link.proforma_id IS NOT NULL) AS has_proforma,
        tax_pl.payper_invoice_link,
        tax_pl.payper_invoice_number,
        fpr."order" AS "order"
      FROM public.finances_paymentplanrow fpr
      LEFT JOIN public.accounting_currencies ac ON ac.id::TEXT = NULLIF(TRIM(fpr.currency_id::TEXT), '')
      LEFT JOIN LATERAL (
        SELECT pl2.secure_token, pl2.status, pl2.expires_at
        FROM public.payment_links pl2
        WHERE pl2.payment_plan_id::TEXT = fpr.id::TEXT
          AND pl2.is_legacy_payment_plan = TRUE
        ORDER BY pl2.created_at DESC
        LIMIT 1
      ) pl ON TRUE
      LEFT JOIN LATERAL (
        SELECT pi.public_token, pi.id AS proforma_id
        FROM public.proformainvoice pi
        WHERE pi.ppr_id = fpr.id
        ORDER BY pi.id DESC
        LIMIT 1
      ) pi_link ON TRUE
      LEFT JOIN LATERAL (
        SELECT
          pl_tax.payper_invoice_link,
          pl_tax.payper_invoice_number
        FROM public.payment_links pl_tax
        WHERE pl_tax.payment_plan_id::TEXT = fpr.id::TEXT
          AND pl_tax.is_legacy_payment_plan = TRUE
          AND pl_tax.status = 'paid'
        ORDER BY
          CASE WHEN pl_tax.payper_invoice_status = 'success' THEN 0 ELSE 1 END,
          CASE WHEN NULLIF(TRIM(pl_tax.payper_invoice_link), '') IS NOT NULL THEN 0 ELSE 1 END,
          pl_tax.paid_at DESC NULLS LAST,
          pl_tax.created_at DESC
        LIMIT 1
      ) tax_pl ON TRUE
      WHERE fpr.lead_id::TEXT = v_session.legacy_lead_id::TEXT
        AND fpr.cancel_date IS NULL
        AND (
          fpr.actual_date IS NOT NULL
          OR COALESCE(fpr.ready_to_pay, FALSE) = TRUE
        )
    ) t;

    SELECT COALESCE(jsonb_agg(row_to_json(t)::JSONB ORDER BY t.paid_at DESC NULLS LAST, t.id DESC), '[]'::JSONB)
    INTO v_proformas
    FROM (
      SELECT
        pi.id,
        pi.public_token,
        pi.created_at,
        TRUE AS is_legacy,
        fpr.actual_date AS paid_at,
        fpr.value,
        fpr.vat_value AS value_vat,
        ac.name AS currency,
        fpr.id AS payment_plan_id
      FROM public.proformainvoice pi
      INNER JOIN public.finances_paymentplanrow fpr
        ON fpr.id = pi.ppr_id
       AND fpr.lead_id::TEXT = v_session.legacy_lead_id::TEXT
       AND fpr.cancel_date IS NULL
       AND fpr.actual_date IS NOT NULL
      LEFT JOIN public.accounting_currencies ac ON ac.id::TEXT = NULLIF(TRIM(fpr.currency_id::TEXT), '')
      WHERE pi.lead_id::TEXT = v_session.legacy_lead_id::TEXT
        AND pi.public_token IS NOT NULL
    ) t;
  ELSE
    -- New leads: create share tokens when proforma JSON exists but token was never generated.
    UPDATE public.payment_plans pp
    SET public_token = gen_random_uuid()::TEXT
    WHERE pp.lead_id::TEXT = v_session.new_lead_id::TEXT
      AND pp.cancel_date IS NULL
      AND pp.proforma IS NOT NULL
      AND NULLIF(TRIM(pp.proforma::TEXT), '') IS NOT NULL
      AND TRIM(pp.proforma::TEXT) NOT IN ('null', '""', '{}')
      AND (pp.public_token IS NULL OR TRIM(pp.public_token) = '');

    SELECT COALESCE(jsonb_agg(row_to_json(t)::JSONB ORDER BY t.due_date NULLS LAST, t.id), '[]'::JSONB)
    INTO v_payments
    FROM (
      SELECT
        pp.id,
        pp.due_date,
        pp.value,
        pp.value_vat,
        COALESCE(pp.paid, FALSE) AS paid,
        pp.paid_at,
        pp.client_id AS plan_contact_id,
        COALESCE(pp.currency, ac.name, '₪') AS currency,
        pl.secure_token,
        pl.status AS link_status,
        pl.expires_at AS link_expires_at,
        FALSE AS is_legacy,
        pp.public_token,
        NULL::BIGINT AS proforma_id,
        (
          pp.proforma IS NOT NULL
          AND NULLIF(TRIM(pp.proforma::TEXT), '') IS NOT NULL
          AND TRIM(pp.proforma::TEXT) NOT IN ('null', '""', '{}')
        ) AS has_proforma,
        tax_pl.payper_invoice_link,
        tax_pl.payper_invoice_number,
        pp.payment_order AS "order"
      FROM public.payment_plans pp
      LEFT JOIN public.accounting_currencies ac ON ac.id::TEXT = NULLIF(TRIM(pp.currency_id::TEXT), '')
      LEFT JOIN LATERAL (
        SELECT pl2.secure_token, pl2.status, pl2.expires_at
        FROM public.payment_links pl2
        WHERE pl2.payment_plan_id::TEXT = pp.id::TEXT
        ORDER BY pl2.created_at DESC
        LIMIT 1
      ) pl ON TRUE
      LEFT JOIN LATERAL (
        SELECT
          pl_tax.payper_invoice_link,
          pl_tax.payper_invoice_number
        FROM public.payment_links pl_tax
        WHERE pl_tax.payment_plan_id::TEXT = pp.id::TEXT
          AND pl_tax.status = 'paid'
        ORDER BY
          CASE WHEN pl_tax.payper_invoice_status = 'success' THEN 0 ELSE 1 END,
          CASE WHEN NULLIF(TRIM(pl_tax.payper_invoice_link), '') IS NOT NULL THEN 0 ELSE 1 END,
          pl_tax.paid_at DESC NULLS LAST,
          pl_tax.created_at DESC
        LIMIT 1
      ) tax_pl ON TRUE
      WHERE pp.lead_id::TEXT = v_session.new_lead_id::TEXT
        AND pp.cancel_date IS NULL
        AND (
          COALESCE(pp.paid, FALSE) = TRUE
          OR COALESCE(pp.ready_to_pay, FALSE) = TRUE
        )
    ) t;

    v_proformas := '[]'::JSONB;
  END IF;

  RETURN jsonb_build_object(
    'payments', v_payments,
    'proformas', v_proformas,
    'is_legacy', v_session.legacy_lead_id IS NOT NULL
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.portal_get_finances(UUID) TO anon, authenticated;
