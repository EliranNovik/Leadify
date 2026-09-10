-- Public contract signing for unsigned (anon) clients.
-- Direct UPDATE on public.leads.stage is not allowed for anon after
-- sql/2026-09-06_leads_wa_window_expires_at.sql (column grant is wa_window_expires_at only).
-- This SECURITY DEFINER RPC writes numeric stage 60 + history when the public_token matches.

DROP FUNCTION IF EXISTS public.update_lead_stage_for_public_contract_new(UUID, TEXT, TEXT);
DROP FUNCTION IF EXISTS public.update_lead_stage_for_public_contract_new(UUID, TEXT, BIGINT);

CREATE OR REPLACE FUNCTION public.update_lead_stage_for_public_contract_new(
  p_contract_id UUID,
  p_public_token TEXT,
  p_stage BIGINT DEFAULT 60
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_client_id UUID;
  v_timestamp TIMESTAMPTZ;
  v_stage_record_id BIGINT;
  v_lead_updated INTEGER;
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

  INSERT INTO public.leads_leadstage (
    newlead_id,
    stage,
    date,
    cdate,
    udate,
    creator_id
  ) VALUES (
    v_client_id,
    p_stage,
    v_timestamp,
    v_timestamp,
    v_timestamp,
    NULL
  )
  RETURNING id INTO v_stage_record_id;

  UPDATE public.leads
  SET
    stage = p_stage,
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

  RETURN jsonb_build_object(
    'success', true,
    'stage_record_id', v_stage_record_id,
    'client_id', v_client_id,
    'stage', p_stage,
    'timestamp', v_timestamp
  );
EXCEPTION
  WHEN OTHERS THEN
    RETURN jsonb_build_object('success', false, 'error', SQLERRM);
END;
$$;

GRANT EXECUTE ON FUNCTION public.update_lead_stage_for_public_contract_new(UUID, TEXT, BIGINT) TO anon;
GRANT EXECUTE ON FUNCTION public.update_lead_stage_for_public_contract_new(UUID, TEXT, BIGINT) TO authenticated;

COMMENT ON FUNCTION public.update_lead_stage_for_public_contract_new(UUID, TEXT, BIGINT) IS
  'Token-gated public contract sign: set new-lead stage to 60 and insert leads_leadstage. Bypasses RLS for anon.';

-- Legacy leads: the previous SECURITY DEFINER RPC failed for anon with
-- permission denied on RI_ConstraintTrigger (FK system trigger / function owner).
-- Recreate without touching lead_stages, run as table owner, and disable RLS inside.

DROP FUNCTION IF EXISTS public.update_lead_stage_for_public_contract_legacy_in_contracts(UUID, TEXT, BIGINT);

CREATE OR REPLACE FUNCTION public.update_lead_stage_for_public_contract_legacy_in_contracts(
  p_contract_id UUID,
  p_public_token TEXT,
  p_stage BIGINT DEFAULT 60
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_legacy_id BIGINT;
  v_timestamp TIMESTAMPTZ;
  v_stage_record_id BIGINT;
  v_lead_updated INTEGER;
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

  INSERT INTO public.leads_leadstage (
    lead_id,
    stage,
    date,
    cdate,
    udate,
    creator_id
  ) VALUES (
    v_legacy_id,
    p_stage,
    v_timestamp,
    v_timestamp,
    v_timestamp,
    NULL
  )
  RETURNING id INTO v_stage_record_id;

  UPDATE public.leads_lead
  SET
    stage = p_stage,
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

  RETURN jsonb_build_object(
    'success', true,
    'stage_record_id', v_stage_record_id,
    'legacy_id', v_legacy_id,
    'stage', p_stage,
    'timestamp', v_timestamp
  );
EXCEPTION
  WHEN OTHERS THEN
    RETURN jsonb_build_object('success', false, 'error', SQLERRM);
END;
$$;

ALTER FUNCTION public.update_lead_stage_for_public_contract_new(UUID, TEXT, BIGINT) OWNER TO postgres;
ALTER FUNCTION public.update_lead_stage_for_public_contract_legacy_in_contracts(UUID, TEXT, BIGINT) OWNER TO postgres;
ALTER FUNCTION public.update_lead_stage_for_public_contract_new(UUID, TEXT, BIGINT) SET row_security = off;
ALTER FUNCTION public.update_lead_stage_for_public_contract_legacy_in_contracts(UUID, TEXT, BIGINT) SET row_security = off;

GRANT EXECUTE ON FUNCTION public.update_lead_stage_for_public_contract_legacy_in_contracts(UUID, TEXT, BIGINT) TO anon;
GRANT EXECUTE ON FUNCTION public.update_lead_stage_for_public_contract_legacy_in_contracts(UUID, TEXT, BIGINT) TO authenticated;

-- Same-transaction path: anon can UPDATE contracts (public_token policy). This trigger
-- runs as postgres so unsigned clients still get stage 60 without a second RLS-blocked write.
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
      AND (stage IS NULL OR stage < 60);
  ELSIF NEW.client_id IS NOT NULL THEN
    INSERT INTO public.leads_leadstage (newlead_id, stage, date, cdate, udate, creator_id)
    VALUES (NEW.client_id, 60, v_ts, v_ts, v_ts, NULL);
    UPDATE public.leads
    SET stage = 60, stage_changed_at = v_ts
    WHERE id = NEW.client_id
      AND (stage IS NULL OR stage < 60);
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

