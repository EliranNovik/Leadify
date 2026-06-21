-- Portal finances: return legacy proformas only for paid payment rows, with amount metadata.

CREATE OR REPLACE FUNCTION public.portal_get_finances(p_token UUID)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
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
        NULL::TEXT AS public_token,
        NULL::BIGINT AS proforma_id,
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
        ac.name AS currency
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
