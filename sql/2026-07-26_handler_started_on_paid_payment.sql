-- =============================================================================
-- RULE (strict forward-only):
--   ONLY 105 (Handler Nominated / Handler Set) → 110 (Handler Started)
--   when at least one payment plan row is PAID.
--
--   Never moves 110 / 150 / 200 / any later stage back to 110.
--   Works for NEW (payment_plans) + LEGACY (finances_paymentplanrow).
--
-- Run this whole file in Supabase SQL editor.
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
      WHERE fpr.lead_id = p_lead_id::BIGINT
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

-- True ONLY for Handler Nominated / Handler Set = stage 105.
-- Never matches 110+ (Handler Started, Application submitted, etc.).
CREATE OR REPLACE FUNCTION public.lead_is_handler_nominated_stage(p_stage TEXT)
RETURNS BOOLEAN
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
  s TEXT := lower(btrim(COALESCE(p_stage, '')));
BEGIN
  -- Strict: only the nominated/set stage. Later stages must never match.
  RETURN s = '105';
END;
$$;

-- ONLY transition allowed: 105 (Handler Nominated/Set) → 110 (Handler Started)
-- Never moves 110 / 150 / 200 / any later stage backwards.
CREATE OR REPLACE FUNCTION public.try_advance_handler_set_to_started(
  p_is_legacy BOOLEAN,
  p_lead_id TEXT
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_ts TIMESTAMPTZ := NOW();
  v_advanced BOOLEAN := FALSE;
  v_stage_from CONSTANT TEXT := '105'; -- Handler Nominated / Set ONLY
  v_stage_to   CONSTANT BIGINT := 110; -- Handler Started
  v_actor TEXT := 'System (payment received)';
  v_legacy_id BIGINT;
  v_new_id UUID;
  v_current_stage TEXT;
BEGIN
  IF p_lead_id IS NULL OR btrim(p_lead_id) = '' THEN
    RETURN FALSE;
  END IF;

  -- HARD RULE: must have at least one paid payment plan row
  IF NOT public.lead_has_paid_payment_plan_row(p_is_legacy, p_lead_id) THEN
    RETURN FALSE;
  END IF;

  IF p_is_legacy THEN
    v_legacy_id := p_lead_id::BIGINT;

    SELECT stage::TEXT INTO v_current_stage
    FROM public.leads_lead
    WHERE id = v_legacy_id;

    -- Guard: only 105 → 110. If already 110+ (or any other stage), no-op.
    IF v_current_stage IS DISTINCT FROM v_stage_from THEN
      RETURN FALSE;
    END IF;

    UPDATE public.leads_lead
    SET
      stage = v_stage_to,
      stage_changed_by = v_actor,
      stage_changed_at = v_ts
    WHERE id = v_legacy_id
      AND stage::TEXT = v_stage_from -- atomic: still exactly 105
    RETURNING TRUE INTO v_advanced;

    IF COALESCE(v_advanced, FALSE) THEN
      BEGIN
        INSERT INTO public.leads_leadstage (
          lead_id, stage, date, cdate, udate, creator_id
        ) VALUES (
          v_legacy_id, v_stage_to, v_ts, v_ts, v_ts, NULL
        );
      EXCEPTION WHEN OTHERS THEN
        RAISE WARNING 'leads_leadstage insert (legacy) failed: %', SQLERRM;
      END;
    END IF;
  ELSE
    v_new_id := p_lead_id::UUID;

    SELECT stage::TEXT INTO v_current_stage
    FROM public.leads
    WHERE id = v_new_id;

    -- Guard: only 105 → 110. If already 110+ (or any other stage), no-op.
    IF v_current_stage IS DISTINCT FROM v_stage_from THEN
      RETURN FALSE;
    END IF;

    UPDATE public.leads
    SET
      stage = v_stage_to,
      stage_changed_by = v_actor,
      stage_changed_at = v_ts
    WHERE id = v_new_id
      AND stage::TEXT = v_stage_from -- atomic: still exactly 105
    RETURNING TRUE INTO v_advanced;

    IF COALESCE(v_advanced, FALSE) THEN
      BEGIN
        INSERT INTO public.leads_leadstage (
          newlead_id, stage, date, cdate, udate, creator_id
        ) VALUES (
          v_new_id, v_stage_to, v_ts, v_ts, v_ts, NULL
        );
      EXCEPTION WHEN OTHERS THEN
        RAISE WARNING 'leads_leadstage insert (new) failed: %', SQLERRM;
      END;
    END IF;
  END IF;

  RETURN COALESCE(v_advanced, FALSE);
EXCEPTION
  WHEN invalid_text_representation THEN
    RETURN FALSE;
  WHEN OTHERS THEN
    RAISE WARNING 'try_advance_handler_set_to_started failed: % (lead=%, legacy=%)',
      SQLERRM, p_lead_id, p_is_legacy;
    RETURN FALSE;
END;
$$;

COMMENT ON FUNCTION public.try_advance_handler_set_to_started(BOOLEAN, TEXT) IS
  'ONLY 105→110 when a paid payment exists. Never moves later stages back to 110.';

-- ---------------------------------------------------------------------------
-- Triggers: fire whenever a row is (or becomes) paid
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.trigger_handler_started_on_payment_plans()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_is_paid BOOLEAN;
BEGIN
  v_is_paid := (
    NEW.cancel_date IS NULL
    AND (
      COALESCE(NEW.paid, FALSE) = TRUE
      OR NEW.paid_at IS NOT NULL
    )
  );

  IF v_is_paid AND NEW.lead_id IS NOT NULL THEN
    PERFORM public.try_advance_handler_set_to_started(FALSE, NEW.lead_id::TEXT);
  END IF;

  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.trigger_handler_started_on_legacy_payment_rows()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_is_paid BOOLEAN;
BEGIN
  v_is_paid := (NEW.cancel_date IS NULL AND NEW.actual_date IS NOT NULL);

  IF v_is_paid AND NEW.lead_id IS NOT NULL THEN
    PERFORM public.try_advance_handler_set_to_started(TRUE, NEW.lead_id::TEXT);
  END IF;

  RETURN NEW;
END;
$$;

-- When stage becomes exactly 105 and a paid payment already exists → 110
CREATE OR REPLACE FUNCTION public.trigger_handler_started_on_lead_stage_105()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Only when entering 105 — never when already past Handler Started
  IF NEW.stage IS DISTINCT FROM OLD.stage
     AND NEW.stage::TEXT = '105' THEN
    IF TG_TABLE_NAME = 'leads_lead' THEN
      PERFORM public.try_advance_handler_set_to_started(TRUE, NEW.id::TEXT);
    ELSE
      PERFORM public.try_advance_handler_set_to_started(FALSE, NEW.id::TEXT);
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_handler_started_on_payment_plans ON public.payment_plans;
CREATE TRIGGER trg_handler_started_on_payment_plans
  AFTER INSERT OR UPDATE ON public.payment_plans
  FOR EACH ROW
  EXECUTE FUNCTION public.trigger_handler_started_on_payment_plans();

DROP TRIGGER IF EXISTS trg_handler_started_on_legacy_payment_rows ON public.finances_paymentplanrow;
CREATE TRIGGER trg_handler_started_on_legacy_payment_rows
  AFTER INSERT OR UPDATE ON public.finances_paymentplanrow
  FOR EACH ROW
  EXECUTE FUNCTION public.trigger_handler_started_on_legacy_payment_rows();

DROP TRIGGER IF EXISTS trg_handler_started_on_leads_stage_105 ON public.leads;
CREATE TRIGGER trg_handler_started_on_leads_stage_105
  AFTER UPDATE OF stage ON public.leads
  FOR EACH ROW
  EXECUTE FUNCTION public.trigger_handler_started_on_lead_stage_105();

DROP TRIGGER IF EXISTS trg_handler_started_on_leads_lead_stage_105 ON public.leads_lead;
CREATE TRIGGER trg_handler_started_on_leads_lead_stage_105
  AFTER UPDATE OF stage ON public.leads_lead
  FOR EACH ROW
  EXECUTE FUNCTION public.trigger_handler_started_on_lead_stage_105();

-- Heal only leads currently stuck on exactly stage 105 with a paid payment
CREATE OR REPLACE FUNCTION public.backfill_handler_started_from_paid_payments()
RETURNS TABLE(advanced_new INTEGER, advanced_legacy INTEGER)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_new INTEGER := 0;
  v_legacy INTEGER := 0;
  r RECORD;
BEGIN
  FOR r IN
    SELECT l.id::TEXT AS lead_id
    FROM public.leads l
    WHERE l.stage::TEXT = '105'
  LOOP
    IF public.try_advance_handler_set_to_started(FALSE, r.lead_id) THEN
      v_new := v_new + 1;
    END IF;
  END LOOP;

  FOR r IN
    SELECT ll.id::TEXT AS lead_id
    FROM public.leads_lead ll
    WHERE ll.stage::TEXT = '105'
  LOOP
    IF public.try_advance_handler_set_to_started(TRUE, r.lead_id) THEN
      v_legacy := v_legacy + 1;
    END IF;
  END LOOP;

  advanced_new := v_new;
  advanced_legacy := v_legacy;
  RETURN NEXT;
END;
$$;

GRANT EXECUTE ON FUNCTION public.lead_has_paid_payment_plan_row(BOOLEAN, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.try_advance_handler_set_to_started(BOOLEAN, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.backfill_handler_started_from_paid_payments() TO authenticated;
GRANT EXECUTE ON FUNCTION public.lead_is_handler_nominated_stage(TEXT) TO authenticated;

-- Run backfill now (safe to re-run)
SELECT * FROM public.backfill_handler_started_from_paid_payments();
