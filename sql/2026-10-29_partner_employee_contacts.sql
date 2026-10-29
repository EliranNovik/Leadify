-- Staff names and emails for a partner firm's integration, without opening the staff tables.
--
-- A partner reads a lead and gets employee ids — `meeting_manager_id`, `closer_id`,
-- `case_handler_id`, the `helper_handler_ids` array — and then needs the person behind each id to
-- put them on a calendar invitation. The emails live in `public.users`, which a partner key cannot
-- read and should not: that table carries every account in the CRM, roles and flags included.
-- `public.tenants_employee` is readable today only for the PEX service employee (177), by
-- sql/pex_agent_integration.sql.
--
-- These two functions answer exactly that question and nothing else. They are SECURITY DEFINER, so
-- they see the staff tables while the caller still cannot, and they return one row per employee:
-- name, work email, and whether that person is still with the firm.
--
-- Safe to re-run.

-- ---------------------------------------------------------------------------
-- id → name + email
-- ---------------------------------------------------------------------------

/*
 * One account per employee, chosen rather than assumed: `public.users` can hold more than one row
 * for the same `employee_id` (an old login kept alongside a new one), and a partner that picked
 * the wrong one would invite a mailbox nobody reads. Active accounts win, then the most recently
 * created.
 */
CREATE OR REPLACE FUNCTION public.partner_employee_contacts(p_employee_ids bigint[])
RETURNS TABLE (
  employee_id bigint,
  name text,
  email text,
  is_active boolean
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH asked AS (
    -- Capped: this answers "who is this id", not "list me the firm".
    SELECT DISTINCT id
    FROM unnest(COALESCE(p_employee_ids, ARRAY[]::bigint[])) AS t(id)
    WHERE id IS NOT NULL
    LIMIT 200
  )
  SELECT
    e.id AS employee_id,
    COALESCE(
      NULLIF(btrim(e.display_name), ''),
      NULLIF(btrim(e.official_name), ''),
      NULLIF(btrim(u.full_name), '')
    ) AS name,
    NULLIF(lower(btrim(u.email)), '') AS email,
    -- Read as text: these flags are boolean in the schema but carry 't' / 'true' strings in places.
    lower(COALESCE(e.fired::text, 'false')) NOT IN ('true', 't', '1') AS is_active
  FROM asked a
  JOIN public.tenants_employee e ON e.id = a.id
  LEFT JOIN LATERAL (
    SELECT uu.email, uu.full_name
    FROM public.users uu
    WHERE uu.employee_id = e.id
    ORDER BY
      (lower(COALESCE(uu.is_active::text, 'true')) IN ('true', 't', '1')) DESC,
      uu.created_at DESC NULLS LAST
    LIMIT 1
  ) u ON true
  ORDER BY e.id;
$$;

COMMENT ON FUNCTION public.partner_employee_contacts(bigint[]) IS
  'Name + work email for the given employee ids, for partner integrations. SECURITY DEFINER so the caller needs no access to users / tenants_employee.';

-- ---------------------------------------------------------------------------
-- The team on one lead, in one call
-- ---------------------------------------------------------------------------

/*
 * The same answer starting from the lead, so a partner does not have to know which column holds
 * which role — or that new leads and legacy leads spell the roles differently.
 *
 * The lead is read as JSON and the role keys are looked up in it, which means a column this CRM
 * does not have is simply absent from the result instead of breaking the function. Roles stored as
 * free text on new leads (`manager`, `helper`, `expert`, `scheduler` hold display names, not ids)
 * are left out: there is no id to resolve, and matching people by name is how the wrong person
 * gets invited.
 */
CREATE OR REPLACE FUNCTION public.partner_lead_team(p_lead_ref text)
RETURNS TABLE (
  role text,
  employee_id bigint,
  name text,
  email text,
  is_active boolean
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  -- Same resolver the partner meeting webhook uses, so 'L12345', a manual id, a legacy id and a
  -- new-lead UUID all work here too.
  v_lead jsonb;
  v_resolved jsonb;
  v_single_roles text[] := ARRAY[
    'meeting_scheduler_id',
    'meeting_manager_id',
    'meeting_lawyer_id',
    'closer_id',
    'meeting_closer_id',
    'case_handler_id',
    'expert_id',
    'expert_examiner_id'
  ];
BEGIN
  v_resolved := public._portal_resolve_lead_ref(p_lead_ref);
  IF v_resolved IS NULL OR v_resolved = 'null'::jsonb THEN
    RETURN;
  END IF;

  IF COALESCE((v_resolved->>'is_legacy')::boolean, false) THEN
    SELECT to_jsonb(l) INTO v_lead
    FROM public.leads_lead l
    WHERE l.id = (v_resolved->>'legacy_lead_id')::bigint;
  ELSE
    SELECT to_jsonb(l) INTO v_lead
    FROM public.leads l
    WHERE l.id = (v_resolved->>'new_lead_id')::uuid;
  END IF;

  IF v_lead IS NULL THEN
    RETURN;
  END IF;

  RETURN QUERY
  WITH ids AS (
    -- One role per column that holds an employee id and actually has one.
    SELECT k.role, (v_lead->>k.role)::bigint AS employee_id
    FROM unnest(v_single_roles) AS k(role)
    WHERE v_lead->>k.role ~ '^\d+$'
    UNION ALL
    -- Helper handlers are an array, kept in step with public.lead_helper_handlers by trigger.
    SELECT 'helper_handler_ids', (t.value #>> '{}')::bigint
    FROM jsonb_array_elements(
      CASE
        WHEN jsonb_typeof(v_lead->'helper_handler_ids') = 'array' THEN v_lead->'helper_handler_ids'
        ELSE '[]'::jsonb
      END
    ) AS t(value)
    WHERE (t.value #>> '{}') ~ '^\d+$'
  )
  SELECT
    i.role,
    c.employee_id,
    c.name,
    c.email,
    c.is_active
  FROM ids i
  JOIN public.partner_employee_contacts(
    (SELECT COALESCE(array_agg(DISTINCT ids.employee_id), ARRAY[]::bigint[]) FROM ids)
  ) c ON c.employee_id = i.employee_id
  ORDER BY i.role, c.employee_id;
END;
$$;

COMMENT ON FUNCTION public.partner_lead_team(text) IS
  'Roles on one lead with each person''s name and work email, for partner integrations. Accepts L-number, manual id, legacy id or new-lead UUID.';

-- ---------------------------------------------------------------------------
-- Who may call them
-- ---------------------------------------------------------------------------

-- `anon` is what the partner / PEX keys authenticate as today (sql/pex_agent_integration.sql).
GRANT EXECUTE ON FUNCTION public.partner_employee_contacts(bigint[]) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.partner_lead_team(text) TO anon, authenticated;

/*
 * Check (replace the ids / lead number):
 *
 *   SELECT * FROM public.partner_employee_contacts(ARRAY[177, 1]::bigint[]);
 *   SELECT * FROM public.partner_lead_team('L209994/3');
 *
 * And from the partner's side, over REST:
 *
 *   POST {SUPABASE_URL}/rest/v1/rpc/partner_lead_team
 *   { "p_lead_ref": "L209994/3" }
 */
