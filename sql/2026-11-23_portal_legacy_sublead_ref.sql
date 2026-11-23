-- Portal login for legacy subleads shown as masterId/suffix (for example 187775/3).
-- That number is not stored. The CRM builds it from master_id and the row's place
-- among siblings ordered by id, counting from /2. /1 is the master itself.
-- Run in the Supabase SQL editor.

CREATE OR REPLACE FUNCTION public._portal_resolve_lead_ref(p_lead_ref TEXT)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_ref TEXT := NULLIF(TRIM(p_lead_ref), '');
  v_legacy RECORD;
  v_new RECORD;
  v_stage_name TEXT;
  v_display TEXT;
  v_base TEXT;
  v_suffix INT;
BEGIN
  IF v_ref IS NULL THEN
    RETURN NULL;
  END IF;

  -- New lead by UUID
  IF v_ref ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
    SELECT l.id, l.name, l.lead_number, l.manual_id, l.stage::TEXT
    INTO v_new
    FROM public.leads l
    WHERE l.id = v_ref::UUID
    LIMIT 1;

    IF FOUND THEN
      SELECT ls.name INTO v_stage_name
      FROM public.lead_stages ls
      WHERE ls.id::TEXT = v_new.stage OR ls.name = v_new.stage
      LIMIT 1;

      RETURN jsonb_build_object(
        'is_legacy', false,
        'new_lead_id', v_new.id,
        'legacy_lead_id', NULL,
        'lead_number', COALESCE(NULLIF(TRIM(v_new.lead_number::TEXT), ''), NULLIF(TRIM(v_new.manual_id::TEXT), ''), v_new.id::TEXT),
        'display_name', v_new.name,
        'stage', v_new.stage,
        'stage_name', COALESCE(v_stage_name, v_new.stage)
      );
    END IF;
  END IF;

  -- Legacy by numeric id
  IF v_ref ~ '^\d+$' THEN
    SELECT ll.id, ll.name, ll.lead_number, ll.manual_id, ll.stage
    INTO v_legacy
    FROM public.leads_lead ll
    WHERE ll.id = v_ref::BIGINT
    LIMIT 1;

    IF FOUND THEN
      SELECT ls.name INTO v_stage_name
      FROM public.lead_stages ls
      WHERE ls.id::TEXT = v_legacy.stage::TEXT OR ls.name = v_legacy.stage::TEXT
      LIMIT 1;

      RETURN jsonb_build_object(
        'is_legacy', true,
        'new_lead_id', NULL,
        'legacy_lead_id', v_legacy.id,
        'lead_number', COALESCE(NULLIF(TRIM(v_legacy.lead_number::TEXT), ''), NULLIF(TRIM(v_legacy.manual_id::TEXT), ''), v_legacy.id::TEXT),
        'display_name', v_legacy.name,
        'stage', v_legacy.stage,
        'stage_name', COALESCE(v_stage_name, v_legacy.stage::TEXT)
      );
    END IF;
  END IF;

  -- New lead by lead_number or manual_id
  SELECT l.id, l.name, l.lead_number, l.manual_id, l.stage::TEXT
  INTO v_new
  FROM public.leads l
  WHERE NULLIF(TRIM(l.lead_number::TEXT), '') = v_ref
     OR NULLIF(TRIM(l.manual_id::TEXT), '') = v_ref
  LIMIT 1;

  IF FOUND THEN
    SELECT ls.name INTO v_stage_name
    FROM public.lead_stages ls
    WHERE ls.id::TEXT = v_new.stage OR ls.name = v_new.stage
    LIMIT 1;

    RETURN jsonb_build_object(
      'is_legacy', false,
      'new_lead_id', v_new.id,
      'legacy_lead_id', NULL,
      'lead_number', COALESCE(NULLIF(TRIM(v_new.lead_number::TEXT), ''), NULLIF(TRIM(v_new.manual_id::TEXT), ''), v_new.id::TEXT),
      'display_name', v_new.name,
      'stage', v_new.stage,
      'stage_name', COALESCE(v_stage_name, v_new.stage)
    );
  END IF;

  -- Legacy by lead_number or manual_id
  SELECT ll.id, ll.name, ll.lead_number, ll.manual_id, ll.stage
  INTO v_legacy
  FROM public.leads_lead ll
  WHERE NULLIF(TRIM(ll.lead_number::TEXT), '') = v_ref
     OR NULLIF(TRIM(ll.manual_id::TEXT), '') = v_ref
  LIMIT 1;

  IF FOUND THEN
    SELECT ls.name INTO v_stage_name
    FROM public.lead_stages ls
    WHERE ls.id::TEXT = v_legacy.stage::TEXT OR ls.name = v_legacy.stage::TEXT
    LIMIT 1;

    RETURN jsonb_build_object(
      'is_legacy', true,
      'new_lead_id', NULL,
      'legacy_lead_id', v_legacy.id,
      'lead_number', COALESCE(NULLIF(TRIM(v_legacy.lead_number::TEXT), ''), NULLIF(TRIM(v_legacy.manual_id::TEXT), ''), v_legacy.id::TEXT),
      'display_name', v_legacy.name,
      'stage', v_legacy.stage,
      'stage_name', COALESCE(v_stage_name, v_legacy.stage::TEXT)
    );
  END IF;

  -- Display number such as 187775/3 or C187775/3. Same order as the client file:
  -- every legacy row with that master_id, ordered by id, first sublead is /2.
  v_display := regexp_replace(v_ref, '^[LC]', '', 'i');
  IF v_display ~ '^\d+/\d+$' THEN
    v_base := split_part(v_display, '/', 1);
    v_suffix := split_part(v_display, '/', 2)::INT;

    IF v_suffix = 1 THEN
      SELECT ll.id, ll.name, ll.lead_number, ll.manual_id, ll.stage
      INTO v_legacy
      FROM public.leads_lead ll
      WHERE ll.id = v_base::BIGINT
      LIMIT 1;
    ELSIF v_suffix >= 2 THEN
      SELECT ll.id, ll.name, ll.lead_number, ll.manual_id, ll.stage
      INTO v_legacy
      FROM public.leads_lead ll
      WHERE NULLIF(TRIM(ll.master_id::TEXT), '') = v_base
      ORDER BY ll.id ASC
      OFFSET (v_suffix - 2)
      LIMIT 1;
    END IF;

    IF v_legacy.id IS NOT NULL THEN
      SELECT ls.name INTO v_stage_name
      FROM public.lead_stages ls
      WHERE ls.id::TEXT = v_legacy.stage::TEXT OR ls.name = v_legacy.stage::TEXT
      LIMIT 1;

      RETURN jsonb_build_object(
        'is_legacy', true,
        'new_lead_id', NULL,
        'legacy_lead_id', v_legacy.id,
        'lead_number', v_base || '/' || v_suffix::TEXT,
        'display_name', v_legacy.name,
        'stage', v_legacy.stage,
        'stage_name', COALESCE(v_stage_name, v_legacy.stage::TEXT)
      );
    END IF;
  END IF;

  RETURN NULL;
END;
$$;

GRANT EXECUTE ON FUNCTION public._portal_resolve_lead_ref(TEXT) TO anon, authenticated;
