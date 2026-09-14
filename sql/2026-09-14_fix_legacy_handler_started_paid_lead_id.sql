-- =============================================================================
-- Fix: Handler Nominated (105) → Handler Started (110) never ran for legacy
-- leads after a payment was marked paid.
--
-- Cause: lead_has_paid_payment_plan_row compared finances_paymentplanrow.lead_id
-- (TEXT) to p_lead_id::BIGINT. Postgres has no text = bigint operator, so the
-- function hit its EXCEPTION handler and returned FALSE. New leads were fine
-- because payment_plans.lead_id is UUID.
--
-- Run this file in the Supabase SQL editor.
-- =============================================================================

CREATE OR REPLACE FUNCTION public.lead_has_paid_payment_plan_row(
  p_is_legacy BOOLEAN,
  p_lead_id TEXT
)
RETURNS BOOLEAN
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_has_paid BOOLEAN := FALSE;
BEGIN
  IF p_lead_id IS NULL OR btrim(p_lead_id) = '' THEN
    RETURN FALSE;
  END IF;

  IF p_is_legacy THEN
    SELECT EXISTS (
      SELECT 1
      FROM public.finances_paymentplanrow fpr
      WHERE btrim(fpr.lead_id::text) = btrim(p_lead_id)
        AND fpr.cancel_date IS NULL
        AND fpr.actual_date IS NOT NULL
      LIMIT 1
    ) INTO v_has_paid;
  ELSE
    SELECT EXISTS (
      SELECT 1
      FROM public.payment_plans pp
      WHERE pp.lead_id = p_lead_id::UUID
        AND pp.cancel_date IS NULL
        AND (
          COALESCE(pp.paid, FALSE) = TRUE
          OR pp.paid_at IS NOT NULL
        )
      LIMIT 1
    ) INTO v_has_paid;
  END IF;

  RETURN COALESCE(v_has_paid, FALSE);
EXCEPTION
  WHEN invalid_text_representation THEN
    RETURN FALSE;
  WHEN OTHERS THEN
    RAISE WARNING 'lead_has_paid_payment_plan_row: % (lead=%, legacy=%)',
      SQLERRM, p_lead_id, p_is_legacy;
    RETURN FALSE;
END;
$$;

COMMENT ON FUNCTION public.lead_has_paid_payment_plan_row(BOOLEAN, TEXT) IS
  'True when the lead has a non-cancelled paid payment row. Legacy compares lead_id as text.';

-- Heal legacy (and new) leads currently stuck on 105 with a paid payment.
SELECT * FROM public.backfill_handler_started_from_paid_payments();
