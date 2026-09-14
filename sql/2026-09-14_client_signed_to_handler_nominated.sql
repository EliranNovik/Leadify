-- =============================================================================
-- RULE (strict forward-only):
--   ONLY 60 (Client signed agreement) → 105 (Handler Nominated / Handler Set)
--   when a case handler is already assigned.
--
-- Why legacy was stuck:
--   Public contract signing writes stage 60 and stops. New leads usually get
--   105 because a human assigns the handler *after* signing (Clients.tsx
--   assignSuccessStageHandler writes 105). Legacy leads often already have
--   case_handler_id before signing, so nobody re-assigns — and the client-page
--   auto-advance was disabled to avoid skipping 60 in stage history.
--
-- This writes current stage 105 and *inserts* a 105 history row. The existing
-- 60 history row from signing is left in place.
--
-- Never moves 110 / 150 / 200 / any later stage back to 105.
-- Works for NEW (leads) + LEGACY (leads_lead).
--
-- Run this whole file in the Supabase SQL editor.
-- =============================================================================

CREATE OR REPLACE FUNCTION public.lead_is_client_signed_stage(p_stage TEXT)
RETURNS BOOLEAN
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
  s TEXT := lower(btrim(COALESCE(p_stage, '')));
BEGIN
  RETURN s = '60';
END;
$$;

CREATE OR REPLACE FUNCTION public.lead_handler_text_is_assigned(p_handler TEXT)
RETURNS BOOLEAN
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
  s TEXT := lower(btrim(COALESCE(p_handler, '')));
BEGIN
  IF s = '' THEN
    RETURN FALSE;
  END IF;
  RETURN s NOT IN ('---', '--', '-', 'not assigned', 'unassigned', 'none', 'null');
END;
$$;

-- ONLY transition allowed: 60 (Client signed) → 105 (Handler Nominated / Set)
CREATE OR REPLACE FUNCTION public.try_advance_client_signed_to_handler_set(
  p_is_legacy BOOLEAN,
  p_lead_id TEXT
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
SET row_security = off
AS $$
DECLARE
  v_ts TIMESTAMPTZ := NOW();
  v_advanced BOOLEAN := FALSE;
  v_stage_from CONSTANT TEXT := '60';
  v_stage_to   CONSTANT BIGINT := 105;
  v_actor TEXT := 'System (handler assigned)';
  v_legacy_id BIGINT;
  v_new_id UUID;
  v_current_stage TEXT;
  v_handler_id BIGINT;
  v_handler_text TEXT;
BEGIN
  IF p_lead_id IS NULL OR btrim(p_lead_id) = '' THEN
    RETURN FALSE;
  END IF;

  IF p_is_legacy THEN
    v_legacy_id := p_lead_id::BIGINT;

    SELECT ll.stage::TEXT, ll.case_handler_id
      INTO v_current_stage, v_handler_id
    FROM public.leads_lead ll
    WHERE ll.id = v_legacy_id;

    IF v_current_stage IS DISTINCT FROM v_stage_from THEN
      RETURN FALSE;
    END IF;
    IF v_handler_id IS NULL THEN
      RETURN FALSE;
    END IF;

    UPDATE public.leads_lead
    SET
      stage = v_stage_to,
      stage_changed_by = v_actor,
      stage_changed_at = v_ts
    WHERE id = v_legacy_id
      AND stage::TEXT = v_stage_from
      AND case_handler_id IS NOT NULL
    RETURNING TRUE INTO v_advanced;

    IF COALESCE(v_advanced, FALSE) THEN
      BEGIN
        INSERT INTO public.leads_leadstage (
          lead_id, stage, date, cdate, udate, creator_id
        ) VALUES (
          v_legacy_id, v_stage_to, v_ts, v_ts, v_ts, NULL
        );
      EXCEPTION WHEN OTHERS THEN
        RAISE WARNING 'leads_leadstage insert (legacy 60→105) failed: %', SQLERRM;
      END;
    END IF;
  ELSE
    v_new_id := p_lead_id::UUID;

    SELECT l.stage::TEXT, l.case_handler_id, l.handler
      INTO v_current_stage, v_handler_id, v_handler_text
    FROM public.leads l
    WHERE l.id = v_new_id;

    IF v_current_stage IS DISTINCT FROM v_stage_from THEN
      RETURN FALSE;
    END IF;
    IF v_handler_id IS NULL AND NOT public.lead_handler_text_is_assigned(v_handler_text) THEN
      RETURN FALSE;
    END IF;

    UPDATE public.leads
    SET
      stage = v_stage_to,
      stage_changed_by = v_actor,
      stage_changed_at = v_ts
    WHERE id = v_new_id
      AND stage::TEXT = v_stage_from
      AND (
        case_handler_id IS NOT NULL
        OR public.lead_handler_text_is_assigned(handler)
      )
    RETURNING TRUE INTO v_advanced;

    IF COALESCE(v_advanced, FALSE) THEN
      BEGIN
        INSERT INTO public.leads_leadstage (
          newlead_id, stage, date, cdate, udate, creator_id
        ) VALUES (
          v_new_id, v_stage_to, v_ts, v_ts, v_ts, NULL
        );
      EXCEPTION WHEN OTHERS THEN
        RAISE WARNING 'leads_leadstage insert (new 60→105) failed: %', SQLERRM;
      END;
    END IF;
  END IF;

  RETURN COALESCE(v_advanced, FALSE);
EXCEPTION
  WHEN invalid_text_representation THEN
    RETURN FALSE;
  WHEN OTHERS THEN
    RAISE WARNING 'try_advance_client_signed_to_handler_set failed: % (lead=%, legacy=%)',
      SQLERRM, p_lead_id, p_is_legacy;
    RETURN FALSE;
END;
$$;

ALTER FUNCTION public.try_advance_client_signed_to_handler_set(BOOLEAN, TEXT) OWNER TO postgres;

COMMENT ON FUNCTION public.try_advance_client_signed_to_handler_set(BOOLEAN, TEXT) IS
  'ONLY 60→105 when a case handler is assigned. Never moves later stages back to 105.';

-- ---------------------------------------------------------------------------
-- Triggers: signing to 60 with a handler already set, or assigning a handler
-- while already at 60.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.trigger_client_signed_to_handler_set()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
SET row_security = off
AS $$
BEGIN
  IF NOT public.lead_is_client_signed_stage(NEW.stage::TEXT) THEN
    RETURN NEW;
  END IF;

  IF TG_TABLE_NAME = 'leads_lead' THEN
    IF NEW.case_handler_id IS NOT NULL THEN
      PERFORM public.try_advance_client_signed_to_handler_set(TRUE, NEW.id::TEXT);
    END IF;
  ELSE
    IF NEW.case_handler_id IS NOT NULL
       OR public.lead_handler_text_is_assigned(NEW.handler) THEN
      PERFORM public.try_advance_client_signed_to_handler_set(FALSE, NEW.id::TEXT);
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

ALTER FUNCTION public.trigger_client_signed_to_handler_set() OWNER TO postgres;

DROP TRIGGER IF EXISTS trg_client_signed_to_handler_set ON public.leads;
CREATE TRIGGER trg_client_signed_to_handler_set
  AFTER INSERT OR UPDATE OF stage, case_handler_id, handler ON public.leads
  FOR EACH ROW
  EXECUTE FUNCTION public.trigger_client_signed_to_handler_set();

DROP TRIGGER IF EXISTS trg_client_signed_to_handler_set ON public.leads_lead;
CREATE TRIGGER trg_client_signed_to_handler_set
  AFTER INSERT OR UPDATE OF stage, case_handler_id ON public.leads_lead
  FOR EACH ROW
  EXECUTE FUNCTION public.trigger_client_signed_to_handler_set();

-- Heal leads currently stuck on exactly stage 60 with a handler assigned
CREATE OR REPLACE FUNCTION public.backfill_handler_set_from_client_signed()
RETURNS TABLE(advanced_new INTEGER, advanced_legacy INTEGER)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
SET row_security = off
AS $$
DECLARE
  v_new INTEGER := 0;
  v_legacy INTEGER := 0;
  r RECORD;
BEGIN
  FOR r IN
    SELECT l.id::TEXT AS lead_id
    FROM public.leads l
    WHERE l.stage::TEXT = '60'
  LOOP
    IF public.try_advance_client_signed_to_handler_set(FALSE, r.lead_id) THEN
      v_new := v_new + 1;
    END IF;
  END LOOP;

  FOR r IN
    SELECT ll.id::TEXT AS lead_id
    FROM public.leads_lead ll
    WHERE ll.stage::TEXT = '60'
  LOOP
    IF public.try_advance_client_signed_to_handler_set(TRUE, r.lead_id) THEN
      v_legacy := v_legacy + 1;
    END IF;
  END LOOP;

  advanced_new := v_new;
  advanced_legacy := v_legacy;
  RETURN NEXT;
END;
$$;

ALTER FUNCTION public.backfill_handler_set_from_client_signed() OWNER TO postgres;

GRANT EXECUTE ON FUNCTION public.lead_is_client_signed_stage(TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.lead_handler_text_is_assigned(TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.try_advance_client_signed_to_handler_set(BOOLEAN, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.backfill_handler_set_from_client_signed() TO authenticated;

-- ---------------------------------------------------------------------------
-- Public contract signing: after writing 60, immediately try 60→105.
-- Explicit PERFORM so this still works if an older RPC disabled ALL triggers
-- on leads_lead around the stage-60 write.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.update_lead_stage_for_public_contract_new(
  p_contract_id UUID,
  p_public_token TEXT,
  p_stage BIGINT DEFAULT 60
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
SET row_security = off
AS $$
DECLARE
  v_client_id UUID;
  v_timestamp TIMESTAMPTZ;
  v_stage_record_id BIGINT;
  v_lead_updated INTEGER;
  v_written_stage BIGINT;
BEGIN
  IF p_public_token IS NULL OR btrim(p_public_token) = '' THEN
    RETURN jsonb_build_object('success', false, 'error', 'Missing public token');
  END IF;

  SELECT client_id
    INTO v_client_id
  FROM public.contracts
  WHERE id = p_contract_id
    AND public_token = p_public_token
    AND public_token IS NOT NULL
    AND client_id IS NOT NULL
    AND legacy_id IS NULL;

  IF v_client_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Invalid contract, token, or client_id');
  END IF;

  v_timestamp := NOW();
  v_written_stage := COALESCE(p_stage, 60);

  INSERT INTO public.leads_leadstage (
    newlead_id,
    stage,
    date,
    cdate,
    udate,
    creator_id
  ) VALUES (
    v_client_id,
    v_written_stage,
    v_timestamp,
    v_timestamp,
    v_timestamp,
    NULL
  )
  RETURNING id INTO v_stage_record_id;

  UPDATE public.leads
  SET
    stage = v_written_stage,
    stage_changed_at = v_timestamp
  WHERE id = v_client_id;

  GET DIAGNOSTICS v_lead_updated = ROW_COUNT;

  IF v_lead_updated = 0 THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'Lead not found or could not be updated',
      'stage_record_id', v_stage_record_id,
      'client_id', v_client_id
    );
  END IF;

  IF v_written_stage = 60 THEN
    PERFORM public.try_advance_client_signed_to_handler_set(FALSE, v_client_id::TEXT);
  END IF;

  RETURN jsonb_build_object(
    'success', true,
    'stage_record_id', v_stage_record_id,
    'client_id', v_client_id,
    'stage', v_written_stage,
    'timestamp', v_timestamp
  );
EXCEPTION
  WHEN OTHERS THEN
    RETURN jsonb_build_object('success', false, 'error', SQLERRM);
END;
$$;

CREATE OR REPLACE FUNCTION public.update_lead_stage_for_public_contract_legacy_in_contracts(
  p_contract_id UUID,
  p_public_token TEXT,
  p_stage BIGINT DEFAULT 60
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
SET row_security = off
AS $$
DECLARE
  v_legacy_id BIGINT;
  v_timestamp TIMESTAMPTZ;
  v_stage_record_id BIGINT;
  v_lead_updated INTEGER;
  v_written_stage BIGINT;
BEGIN
  IF p_public_token IS NULL OR btrim(p_public_token) = '' THEN
    RETURN jsonb_build_object('success', false, 'error', 'Missing public token');
  END IF;

  SELECT CAST(legacy_id AS BIGINT)
    INTO v_legacy_id
  FROM public.contracts
  WHERE id = p_contract_id
    AND public_token = p_public_token
    AND public_token IS NOT NULL
    AND legacy_id IS NOT NULL;

  IF v_legacy_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Invalid contract, token, or legacy_id');
  END IF;

  v_timestamp := NOW();
  v_written_stage := COALESCE(p_stage, 60);

  INSERT INTO public.leads_leadstage (
    lead_id,
    stage,
    date,
    cdate,
    udate,
    creator_id
  ) VALUES (
    v_legacy_id,
    v_written_stage,
    v_timestamp,
    v_timestamp,
    v_timestamp,
    NULL
  )
  RETURNING id INTO v_stage_record_id;

  UPDATE public.leads_lead
  SET
    stage = v_written_stage,
    stage_changed_at = v_timestamp
  WHERE id = v_legacy_id;

  GET DIAGNOSTICS v_lead_updated = ROW_COUNT;

  IF v_lead_updated = 0 THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'Lead not found or could not be updated',
      'stage_record_id', v_stage_record_id,
      'legacy_id', v_legacy_id
    );
  END IF;

  IF v_written_stage = 60 THEN
    PERFORM public.try_advance_client_signed_to_handler_set(TRUE, v_legacy_id::TEXT);
  END IF;

  RETURN jsonb_build_object(
    'success', true,
    'stage_record_id', v_stage_record_id,
    'legacy_id', v_legacy_id,
    'stage', v_written_stage,
    'timestamp', v_timestamp
  );
EXCEPTION
  WHEN OTHERS THEN
    RETURN jsonb_build_object('success', false, 'error', SQLERRM);
END;
$$;

ALTER FUNCTION public.update_lead_stage_for_public_contract_new(UUID, TEXT, BIGINT) OWNER TO postgres;
ALTER FUNCTION public.update_lead_stage_for_public_contract_legacy_in_contracts(UUID, TEXT, BIGINT) OWNER TO postgres;

GRANT EXECUTE ON FUNCTION public.update_lead_stage_for_public_contract_new(UUID, TEXT, BIGINT) TO anon;
GRANT EXECUTE ON FUNCTION public.update_lead_stage_for_public_contract_new(UUID, TEXT, BIGINT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.update_lead_stage_for_public_contract_legacy_in_contracts(UUID, TEXT, BIGINT) TO anon;
GRANT EXECUTE ON FUNCTION public.update_lead_stage_for_public_contract_legacy_in_contracts(UUID, TEXT, BIGINT) TO authenticated;

CREATE OR REPLACE FUNCTION public.trg_public_contract_signed_lead_stage()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
SET row_security = off
AS $$
DECLARE
  v_ts timestamptz := now();
BEGIN
  IF NEW.status IS DISTINCT FROM 'signed' OR OLD.status IS NOT DISTINCT FROM 'signed' THEN
    RETURN NEW;
  END IF;
  IF NEW.employee_id IS NOT NULL OR NEW.external_firm_id IS NOT NULL OR NEW.user_id IS NOT NULL THEN
    RETURN NEW;
  END IF;

  IF NEW.legacy_id IS NOT NULL THEN
    INSERT INTO public.leads_leadstage (lead_id, stage, date, cdate, udate, creator_id)
    VALUES (NEW.legacy_id::bigint, 60, v_ts, v_ts, v_ts, NULL);
    UPDATE public.leads_lead
    SET stage = 60, stage_changed_at = v_ts
    WHERE id = NEW.legacy_id::bigint
      AND (
        stage IS NULL
        OR (stage::TEXT ~ '^[0-9]+$' AND stage::BIGINT < 60)
      );
    PERFORM public.try_advance_client_signed_to_handler_set(TRUE, NEW.legacy_id::TEXT);
  ELSIF NEW.client_id IS NOT NULL THEN
    INSERT INTO public.leads_leadstage (newlead_id, stage, date, cdate, udate, creator_id)
    VALUES (NEW.client_id, 60, v_ts, v_ts, v_ts, NULL);
    UPDATE public.leads
    SET stage = 60, stage_changed_at = v_ts
    WHERE id = NEW.client_id
      AND (
        stage IS NULL
        OR (stage::TEXT ~ '^[0-9]+$' AND stage::BIGINT < 60)
      );
    PERFORM public.try_advance_client_signed_to_handler_set(FALSE, NEW.client_id::TEXT);
  END IF;

  RETURN NEW;
END;
$$;

ALTER FUNCTION public.trg_public_contract_signed_lead_stage() OWNER TO postgres;

DROP TRIGGER IF EXISTS trg_public_contract_signed_lead_stage ON public.contracts;
CREATE TRIGGER trg_public_contract_signed_lead_stage
  AFTER UPDATE OF status ON public.contracts
  FOR EACH ROW
  EXECUTE FUNCTION public.trg_public_contract_signed_lead_stage();

-- Heal currently stuck signed+handler leads
SELECT * FROM public.backfill_handler_set_from_client_signed();
