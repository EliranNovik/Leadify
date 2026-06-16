-- PEX external agent integration (Supabase anon key)
--
-- PREREQUISITE:
--   1. sql/create_lead_manual_interactions_table.sql
--   2. sql/lead_manual_interactions_add_employee_id.sql
--
-- Replaces the old approach (UPDATE leads.manual_interactions JSONB directly).
-- PEX should INSERT rows into public.lead_manual_interactions.
-- A trigger mirrors those rows into leads.manual_interactions so the CRM UI
-- and stage-evaluation triggers keep working.
--
-- Share with PEX:
--   1. Supabase Project URL  (Dashboard → Settings → API)
--   2. Supabase anon key     (same page)
--   3. Run this SQL once in the SQL Editor

-- ---------------------------------------------------------------------------
-- Helpers: normalize ids + sync table → leads.manual_interactions JSONB
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.pex_normalize_manual_interaction_id(id_text text)
RETURNS text
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE
    WHEN id_text IS NULL OR btrim(id_text) = '' THEN NULL
    WHEN id_text LIKE 'manual_%' THEN id_text
    WHEN id_text ~ '^\d+$' THEN 'manual_' || id_text
    ELSE id_text
  END;
$$;

CREATE OR REPLACE FUNCTION public.sync_lead_manual_interactions_json_for_lead(p_lead_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_table_json jsonb := '[]'::jsonb;
  v_legacy_json jsonb;
  v_merged jsonb;
  v_table_ids text[];
  v_legacy_elem jsonb;
  v_legacy_only jsonb := '[]'::jsonb;
BEGIN
  SELECT COALESCE(
    jsonb_agg(row_json ORDER BY raw_date DESC),
    '[]'::jsonb
  )
  INTO v_table_json
  FROM (
    SELECT
      COALESCE(lmi.payload, '{}'::jsonb) || jsonb_strip_nulls(
        jsonb_build_object(
          'id', lmi.id,
          'date', lmi.interaction_date,
          'time', lmi.interaction_time,
          'raw_date', to_jsonb(lmi.raw_date),
          'employee', lmi.employee,
          'recipient_name', lmi.recipient_name,
          'direction', lmi.direction,
          'kind', lmi.kind,
          'length', lmi.length,
          'content', lmi.content,
          'observation', lmi.observation,
          'editable', lmi.editable,
          'contact_id', lmi.contact_id,
          'contact_name', lmi.contact_name,
          'minutes', lmi.minutes,
          'employee_id', lmi.employee_id
        )
      ) AS row_json,
      lmi.raw_date
    FROM public.lead_manual_interactions lmi
    WHERE lmi.lead_id = p_lead_id
  ) s;

  SELECT COALESCE(array_agg(public.pex_normalize_manual_interaction_id(id)), ARRAY[]::text[])
  INTO v_table_ids
  FROM public.lead_manual_interactions
  WHERE lead_id = p_lead_id;

  SELECT COALESCE(manual_interactions, '[]'::jsonb)
  INTO v_legacy_json
  FROM public.leads
  WHERE id = p_lead_id;

  IF jsonb_typeof(v_legacy_json) = 'array' THEN
    FOR v_legacy_elem IN SELECT value FROM jsonb_array_elements(v_legacy_json) AS t(value)
    LOOP
      IF NOT (
        public.pex_normalize_manual_interaction_id(v_legacy_elem->>'id') = ANY (v_table_ids)
      ) THEN
        v_legacy_only := v_legacy_only || jsonb_build_array(v_legacy_elem);
      END IF;
    END LOOP;
  END IF;

  v_merged := v_table_json || v_legacy_only;

  UPDATE public.leads
  SET
    manual_interactions = v_merged,
    latest_interaction = NOW()
  WHERE id = p_lead_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.trg_sync_lead_manual_interactions_json()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM public.sync_lead_manual_interactions_json_for_lead(
    COALESCE(NEW.lead_id, OLD.lead_id)
  );
  RETURN COALESCE(NEW, OLD);
END;
$$;

DROP TRIGGER IF EXISTS trg_lead_manual_interactions_sync_json ON public.lead_manual_interactions;
CREATE TRIGGER trg_lead_manual_interactions_sync_json
  AFTER INSERT OR UPDATE OR DELETE ON public.lead_manual_interactions
  FOR EACH ROW
  EXECUTE FUNCTION public.trg_sync_lead_manual_interactions_json();

-- ---------------------------------------------------------------------------
-- PEX read access (lookup tables + leads)
-- ---------------------------------------------------------------------------

GRANT USAGE ON SCHEMA public TO anon;

GRANT SELECT ON public.leads TO anon;
GRANT SELECT ON public.misc_leadsource TO anon;
GRANT SELECT ON public.misc_language TO anon;

DROP POLICY IF EXISTS "pex_readonly" ON public.leads;
CREATE POLICY "pex_readonly"
  ON public.leads
  FOR SELECT
  TO anon
  USING (true);

DROP POLICY IF EXISTS "pex_readonly" ON public.misc_leadsource;
CREATE POLICY "pex_readonly"
  ON public.misc_leadsource
  FOR SELECT
  TO anon
  USING (true);

DROP POLICY IF EXISTS "pex_readonly" ON public.misc_language;
CREATE POLICY "pex_readonly"
  ON public.misc_language
  FOR SELECT
  TO anon
  USING (true);

-- ---------------------------------------------------------------------------
-- PEX write access: INSERT manual interactions only (new leads / UUID leads)
-- ---------------------------------------------------------------------------

GRANT SELECT, INSERT ON public.lead_manual_interactions TO anon;

DROP POLICY IF EXISTS "pex_select_manual_interactions" ON public.lead_manual_interactions;
CREATE POLICY "pex_select_manual_interactions"
  ON public.lead_manual_interactions
  FOR SELECT
  TO anon
  USING (true);

DROP POLICY IF EXISTS "pex_insert_manual_interactions" ON public.lead_manual_interactions;
CREATE POLICY "pex_insert_manual_interactions"
  ON public.lead_manual_interactions
  FOR INSERT
  TO anon
  WITH CHECK (
    EXISTS (SELECT 1 FROM public.leads l WHERE l.id = lead_id)
    AND direction IN ('in', 'out')
    AND kind IN ('email', 'whatsapp', 'call', 'sms', 'office')
    AND employee_id = 177
  );

-- ---------------------------------------------------------------------------
-- PEX service employee (id 177): read name + auto-fill employee text on insert
-- ---------------------------------------------------------------------------

GRANT SELECT ON public.tenants_employee TO anon;

DROP POLICY IF EXISTS "pex_read_employee_177" ON public.tenants_employee;
CREATE POLICY "pex_read_employee_177"
  ON public.tenants_employee
  FOR SELECT
  TO anon
  USING (id = 177);

CREATE OR REPLACE FUNCTION public.pex_fill_manual_interaction_employee()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_name text;
BEGIN
  IF NEW.employee_id IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT COALESCE(NULLIF(btrim(display_name), ''), NULLIF(btrim(official_name), ''))
  INTO v_name
  FROM public.tenants_employee
  WHERE id = NEW.employee_id;

  IF v_name IS NOT NULL AND (NEW.employee IS NULL OR btrim(NEW.employee) = '') THEN
    NEW.employee := v_name;
  END IF;

  IF NEW.payload IS NULL OR NEW.payload = '{}'::jsonb THEN
    NEW.payload := jsonb_build_object('employee_id', NEW.employee_id, 'source', 'pex');
  ELSE
    NEW.payload := NEW.payload || jsonb_build_object('employee_id', NEW.employee_id);
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_pex_fill_manual_interaction_employee ON public.lead_manual_interactions;
CREATE TRIGGER trg_pex_fill_manual_interaction_employee
  BEFORE INSERT ON public.lead_manual_interactions
  FOR EACH ROW
  WHEN (NEW.employee_id IS NOT NULL)
  EXECUTE FUNCTION public.pex_fill_manual_interaction_employee();

-- Do NOT grant UPDATE on leads.manual_interactions to anon (deprecated write path).

COMMENT ON FUNCTION public.sync_lead_manual_interactions_json_for_lead(uuid) IS
  'Rebuilds leads.manual_interactions from lead_manual_interactions (+ legacy JSON not superseded by table ids). Fires stage evaluation via existing leads UPDATE trigger.';
