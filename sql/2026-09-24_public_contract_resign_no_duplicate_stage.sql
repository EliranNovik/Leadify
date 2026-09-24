-- Re-signing an amended contract must not re-open the "Client signed agreement" stage.
--
-- Context: with archived contracts, a lead can sign a second (amended) contract long after
-- it moved past stage 60. Three separate paths write stage 60 on a public signing:
--   1. trigger trg_public_contract_signed_lead_stage (AFTER UPDATE OF status ON contracts)
--   2. RPC update_lead_stage_for_public_contract_new                (new leads, contracts table)
--   3. RPC update_lead_stage_for_public_contract_legacy_in_contracts (legacy leads, contracts table)
--   4. RPC update_lead_stage_for_public_contract                    (legacy lead_leadcontact contracts)
--
-- Before this migration every one of them inserted into leads_leadstage unconditionally, so
-- (a) a re-sign logged a second "signed deal" event and dragged the lead back to 60, and
-- (b) even a first signing wrote two history rows, because the trigger and the RPC both fired
--     on the same sign UPDATE.
--
-- Rules applied consistently below:
--   * history INSERT  -> only when the lead has no stage-60 row yet (never log a 2nd signed deal)
--   * stage UPDATE    -> only when the lead has not reached 60 yet (never move it backwards)
--   * stage 91 (Dropped / Spam-Irrelevant) is numerically above 60 but is not "past signing",
--     so it is still revived to 60. This keeps the net behaviour the unguarded RPCs had.
--   * skipping returns success (with skipped=true) so the public page shows no scary warning,
--     and reports back the lead's actual current stage instead of a hardcoded 60.

-- ---------------------------------------------------------------------------
-- 1. Trigger: same-transaction path for anon signers
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.trg_public_contract_signed_lead_stage()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
SET row_security = off
AS $$
DECLARE
  v_ts timestamptz := now();
  v_already_signed boolean;
BEGIN
  IF NEW.status IS DISTINCT FROM 'signed' OR OLD.status IS NOT DISTINCT FROM 'signed' THEN
    RETURN NEW;
  END IF;
  IF NEW.employee_id IS NOT NULL OR NEW.external_firm_id IS NOT NULL OR NEW.user_id IS NOT NULL THEN
    RETURN NEW;
  END IF;

  IF NEW.legacy_id IS NOT NULL THEN
    SELECT EXISTS (
      SELECT 1 FROM public.leads_leadstage
      WHERE lead_id = NEW.legacy_id::bigint AND stage = 60
    ) INTO v_already_signed;

    IF NOT v_already_signed THEN
      INSERT INTO public.leads_leadstage (lead_id, stage, date, cdate, udate, creator_id)
      VALUES (NEW.legacy_id::bigint, 60, v_ts, v_ts, v_ts, NULL);
    END IF;

    UPDATE public.leads_lead
    SET stage = 60, stage_changed_at = v_ts
    WHERE id = NEW.legacy_id::bigint
      AND (stage IS NULL OR stage < 60 OR stage = 91);

  ELSIF NEW.client_id IS NOT NULL THEN
    SELECT EXISTS (
      SELECT 1 FROM public.leads_leadstage
      WHERE newlead_id = NEW.client_id AND stage = 60
    ) INTO v_already_signed;

    IF NOT v_already_signed THEN
      INSERT INTO public.leads_leadstage (newlead_id, stage, date, cdate, udate, creator_id)
      VALUES (NEW.client_id, 60, v_ts, v_ts, v_ts, NULL);
    END IF;

    UPDATE public.leads
    SET stage = 60, stage_changed_at = v_ts
    WHERE id = NEW.client_id
      AND (stage IS NULL OR stage < 60 OR stage = 91);
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

-- ---------------------------------------------------------------------------
-- 2. New leads (contracts.client_id)
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
AS $$
DECLARE
  v_client_id UUID;
  v_timestamp TIMESTAMPTZ;
  v_stage_record_id BIGINT;
  v_lead_updated INTEGER;
  v_current_stage BIGINT;
  v_already_signed BOOLEAN;
  v_wrote_stage BOOLEAN := false;
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

  SELECT stage INTO v_current_stage FROM public.leads WHERE id = v_client_id;

  SELECT EXISTS (
    SELECT 1 FROM public.leads_leadstage
    WHERE newlead_id = v_client_id AND stage = p_stage
  ) INTO v_already_signed;

  -- Never log a second signed deal for the same lead.
  IF NOT v_already_signed THEN
    INSERT INTO public.leads_leadstage (
      newlead_id, stage, date, cdate, udate, creator_id
    ) VALUES (
      v_client_id, p_stage, v_timestamp, v_timestamp, v_timestamp, NULL
    )
    RETURNING id INTO v_stage_record_id;
  END IF;

  -- Never move an already-progressed lead backwards (91 = Dropped is still revived).
  IF v_current_stage IS NULL OR v_current_stage < p_stage OR v_current_stage = 91 THEN
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

    v_wrote_stage := true;
    v_current_stage := p_stage;
  END IF;

  RETURN jsonb_build_object(
    'success', true,
    'skipped', NOT (v_wrote_stage OR v_stage_record_id IS NOT NULL),
    'stage_record_id', v_stage_record_id,
    'client_id', v_client_id,
    'stage', COALESCE(v_current_stage, p_stage),
    'timestamp', v_timestamp
  );
EXCEPTION
  WHEN OTHERS THEN
    RETURN jsonb_build_object('success', false, 'error', SQLERRM);
END;
$$;

-- ---------------------------------------------------------------------------
-- 3. Legacy leads holding their contract in the contracts table
-- ---------------------------------------------------------------------------
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
  v_current_stage BIGINT;
  v_already_signed BOOLEAN;
  v_wrote_stage BOOLEAN := false;
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

  SELECT stage INTO v_current_stage FROM public.leads_lead WHERE id = v_legacy_id;

  SELECT EXISTS (
    SELECT 1 FROM public.leads_leadstage
    WHERE lead_id = v_legacy_id AND stage = p_stage
  ) INTO v_already_signed;

  IF NOT v_already_signed THEN
    INSERT INTO public.leads_leadstage (
      lead_id, stage, date, cdate, udate, creator_id
    ) VALUES (
      v_legacy_id, p_stage, v_timestamp, v_timestamp, v_timestamp, NULL
    )
    RETURNING id INTO v_stage_record_id;
  END IF;

  IF v_current_stage IS NULL OR v_current_stage < p_stage OR v_current_stage = 91 THEN
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

    v_wrote_stage := true;
    v_current_stage := p_stage;
  END IF;

  RETURN jsonb_build_object(
    'success', true,
    'skipped', NOT (v_wrote_stage OR v_stage_record_id IS NOT NULL),
    'stage_record_id', v_stage_record_id,
    'legacy_id', v_legacy_id,
    'stage', COALESCE(v_current_stage, p_stage),
    'timestamp', v_timestamp
  );
EXCEPTION
  WHEN OTHERS THEN
    RETURN jsonb_build_object('success', false, 'error', SQLERRM);
END;
$$;

-- ---------------------------------------------------------------------------
-- 4. Legacy contracts still stored on lead_leadcontact (PublicLegacyContractView)
--
-- This name has accumulated several overloads over time ((BIGINT,INTEGER,TEXT),
-- (INTEGER,INTEGER,TEXT), (BIGINT,BIGINT,TEXT)...). Overloads are dangerous here:
-- PostgREST resolves the RPC by the JSON argument types, so an unguarded leftover
-- overload could still be the one that runs and double-logs the signed deal.
-- Drop every existing overload first so exactly one guarded definition remains.
-- (proname is matched exactly, so the _new / _legacy_in_contracts functions above
-- are not affected.)
DO $do$
DECLARE
  r RECORD;
BEGIN
  FOR r IN
    SELECT p.oid::regprocedure AS sig
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname = 'update_lead_stage_for_public_contract'
  LOOP
    EXECUTE format('DROP FUNCTION IF EXISTS %s', r.sig);
  END LOOP;
END
$do$;

CREATE OR REPLACE FUNCTION public.update_lead_stage_for_public_contract(
  p_lead_id BIGINT,
  p_stage BIGINT,
  p_public_token TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_contract_exists BOOLEAN;
  v_timestamp TIMESTAMP WITH TIME ZONE;
  v_stage_record_id BIGINT;
  v_lead_updated INTEGER;
  v_current_stage BIGINT;
  v_already_signed BOOLEAN;
  v_wrote_stage BOOLEAN := false;
BEGIN
  SELECT EXISTS(
    SELECT 1
    FROM lead_leadcontact
    WHERE lead_id = p_lead_id
    AND public_token = p_public_token
    AND public_token IS NOT NULL
  ) INTO v_contract_exists;

  IF NOT v_contract_exists THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'Invalid contract or token. Contract may not have a public_token set.'
    );
  END IF;

  v_timestamp := NOW();

  SELECT stage INTO v_current_stage FROM leads_lead WHERE id = p_lead_id;

  SELECT EXISTS (
    SELECT 1 FROM leads_leadstage
    WHERE lead_id = p_lead_id AND stage = p_stage::BIGINT
  ) INTO v_already_signed;

  IF NOT v_already_signed THEN
    INSERT INTO leads_leadstage (
      lead_id, stage, date, cdate, udate, creator_id
    ) VALUES (
      p_lead_id, p_stage::BIGINT, v_timestamp, v_timestamp, v_timestamp, NULL
    )
    RETURNING id INTO v_stage_record_id;
  END IF;

  IF v_current_stage IS NULL OR v_current_stage < p_stage::BIGINT OR v_current_stage = 91 THEN
    UPDATE leads_lead
    SET
      stage = p_stage::BIGINT,
      stage_changed_by = 'Public Contract Signing',
      stage_changed_at = v_timestamp
    WHERE id = p_lead_id;

    GET DIAGNOSTICS v_lead_updated = ROW_COUNT;

    IF v_lead_updated = 0 THEN
      RETURN jsonb_build_object(
        'success', false,
        'error', 'Lead not found or could not be updated'
      );
    END IF;

    v_wrote_stage := true;
    v_current_stage := p_stage::BIGINT;
  END IF;

  RETURN jsonb_build_object(
    'success', true,
    'skipped', NOT (v_wrote_stage OR v_stage_record_id IS NOT NULL),
    'stage_record_id', v_stage_record_id,
    'lead_id', p_lead_id,
    'stage', COALESCE(v_current_stage, p_stage::BIGINT),
    'timestamp', v_timestamp
  );

EXCEPTION
  WHEN OTHERS THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', SQLERRM
    );
END;
$$;

-- ---------------------------------------------------------------------------
-- Ownership / RLS / grants (unchanged from 2026-09-10, re-applied after CREATE OR REPLACE)
-- ---------------------------------------------------------------------------
ALTER FUNCTION public.update_lead_stage_for_public_contract_new(UUID, TEXT, BIGINT) OWNER TO postgres;
ALTER FUNCTION public.update_lead_stage_for_public_contract_legacy_in_contracts(UUID, TEXT, BIGINT) OWNER TO postgres;
ALTER FUNCTION public.update_lead_stage_for_public_contract_new(UUID, TEXT, BIGINT) SET row_security = off;
ALTER FUNCTION public.update_lead_stage_for_public_contract_legacy_in_contracts(UUID, TEXT, BIGINT) SET row_security = off;

GRANT EXECUTE ON FUNCTION public.update_lead_stage_for_public_contract_new(UUID, TEXT, BIGINT) TO anon;
GRANT EXECUTE ON FUNCTION public.update_lead_stage_for_public_contract_new(UUID, TEXT, BIGINT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.update_lead_stage_for_public_contract_legacy_in_contracts(UUID, TEXT, BIGINT) TO anon;
GRANT EXECUTE ON FUNCTION public.update_lead_stage_for_public_contract_legacy_in_contracts(UUID, TEXT, BIGINT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.update_lead_stage_for_public_contract(BIGINT, BIGINT, TEXT) TO anon;
GRANT EXECUTE ON FUNCTION public.update_lead_stage_for_public_contract(BIGINT, BIGINT, TEXT) TO authenticated;

COMMENT ON FUNCTION public.update_lead_stage_for_public_contract_new(UUID, TEXT, BIGINT) IS
  'Token-gated public contract sign for new leads. Inserts leads_leadstage only if the lead has no stage-60 row yet, and updates leads.stage only if it has not reached 60 (91 excepted). Safe to call on a re-signed amended contract.';

COMMENT ON FUNCTION public.update_lead_stage_for_public_contract_legacy_in_contracts(UUID, TEXT, BIGINT) IS
  'Token-gated public contract sign for legacy leads in the contracts table. Same no-duplicate-signed-deal guards as the new-lead variant.';

COMMENT ON FUNCTION public.update_lead_stage_for_public_contract(BIGINT, BIGINT, TEXT) IS
  'Token-gated public contract sign for legacy lead_leadcontact contracts. Same no-duplicate-signed-deal guards as the new-lead variant.';
