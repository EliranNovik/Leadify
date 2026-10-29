-- A key of its own for the PEX / partner integration, instead of the project's anon key.
--
-- WHY
--   sql/pex_agent_integration.sql gave the integration what it needs by granting it to `anon`:
--   SELECT on public.leads, SELECT + INSERT on emails, whatsapp_messages and
--   lead_manual_interactions. `anon` is the role the *publishable* key maps to — the key compiled
--   into our own web app, readable by anyone who opens the browser console on rainmakerqueen.org.
--   So those grants are not "the partner can read leads", they are "everyone can read every lead,
--   every email and every WhatsApp message". That is also why rotating the anon key is no answer:
--   the key was never a secret, and rotating it re-keys our frontend without closing anything.
--
--   The fix is a role only the integration has a token for. Then its access can be rotated,
--   narrowed or switched off without touching our app, and the public key goes back to being
--   public.
--
-- WHAT THIS FILE DOES (phase 1, safe to run now)
--   Creates `pex_agent` and gives it exactly what the integration uses today. Nothing is taken
--   away from `anon` here, so the integration keeps working on its current key while it switches.
--
-- AFTER THE PARTNER HAS SWITCHED (phase 2)
--   Run the final block, which is commented out. Read its notes first: one of the anon policies is
--   also used by our own public contract page.
--
-- Safe to re-run.

-- ---------------------------------------------------------------------------
-- The role
-- ---------------------------------------------------------------------------

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'pex_agent') THEN
    -- NOLOGIN: reached only through PostgREST with a token, never as a database login.
    CREATE ROLE pex_agent NOLOGIN NOINHERIT;
  END IF;
END $$;

-- PostgREST switches into the request's role from `authenticator`, so it must be allowed to.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticator') THEN
    EXECUTE 'GRANT pex_agent TO authenticator';
  END IF;
END $$;

GRANT USAGE ON SCHEMA public TO pex_agent;

-- (No COMMENT ON ROLE: Postgres reserves commenting on roles for superusers, which the project
-- owner is not on Supabase. What the role is for is written at the top of this file.)

-- ---------------------------------------------------------------------------
-- Reading: leads and the two lookup tables it joins
-- ---------------------------------------------------------------------------

GRANT SELECT ON public.leads TO pex_agent;
GRANT SELECT ON public.misc_leadsource TO pex_agent;
GRANT SELECT ON public.misc_language TO pex_agent;

DROP POLICY IF EXISTS "pex_agent_read_leads" ON public.leads;
CREATE POLICY "pex_agent_read_leads"
  ON public.leads
  FOR SELECT
  TO pex_agent
  USING (true);

DROP POLICY IF EXISTS "pex_agent_read_leadsource" ON public.misc_leadsource;
CREATE POLICY "pex_agent_read_leadsource"
  ON public.misc_leadsource
  FOR SELECT
  TO pex_agent
  USING (true);

DROP POLICY IF EXISTS "pex_agent_read_language" ON public.misc_language;
CREATE POLICY "pex_agent_read_language"
  ON public.misc_language
  FOR SELECT
  TO pex_agent
  USING (true);

-- The service employee the integration writes as, and nobody else.
GRANT SELECT ON public.tenants_employee TO pex_agent;

DROP POLICY IF EXISTS "pex_agent_read_employee_177" ON public.tenants_employee;
CREATE POLICY "pex_agent_read_employee_177"
  ON public.tenants_employee
  FOR SELECT
  TO pex_agent
  USING (id = 177);

-- ---------------------------------------------------------------------------
-- Writing: the three things the integration records
-- ---------------------------------------------------------------------------

GRANT SELECT, INSERT ON public.lead_manual_interactions TO pex_agent;

DROP POLICY IF EXISTS "pex_agent_select_manual_interactions" ON public.lead_manual_interactions;
CREATE POLICY "pex_agent_select_manual_interactions"
  ON public.lead_manual_interactions
  FOR SELECT
  TO pex_agent
  USING (true);

DROP POLICY IF EXISTS "pex_agent_insert_manual_interactions" ON public.lead_manual_interactions;
CREATE POLICY "pex_agent_insert_manual_interactions"
  ON public.lead_manual_interactions
  FOR INSERT
  TO pex_agent
  WITH CHECK (
    EXISTS (SELECT 1 FROM public.leads l WHERE l.id = lead_id)
    AND direction IN ('in', 'out')
    AND kind IN ('email', 'whatsapp', 'call', 'sms', 'office')
    AND employee_id = 177
  );

GRANT SELECT, INSERT ON public.emails TO pex_agent;

DROP POLICY IF EXISTS "pex_agent_select_emails" ON public.emails;
CREATE POLICY "pex_agent_select_emails"
  ON public.emails
  FOR SELECT
  TO pex_agent
  USING (true);

DROP POLICY IF EXISTS "pex_agent_insert_emails" ON public.emails;
CREATE POLICY "pex_agent_insert_emails"
  ON public.emails
  FOR INSERT
  TO pex_agent
  WITH CHECK (
    client_id IS NOT NULL
    AND EXISTS (SELECT 1 FROM public.leads l WHERE l.id = client_id)
    AND direction IN ('incoming', 'outgoing')
  );

GRANT SELECT, INSERT ON public.whatsapp_messages TO pex_agent;

DROP POLICY IF EXISTS "pex_agent_select_whatsapp_messages" ON public.whatsapp_messages;
CREATE POLICY "pex_agent_select_whatsapp_messages"
  ON public.whatsapp_messages
  FOR SELECT
  TO pex_agent
  USING (true);

DROP POLICY IF EXISTS "pex_agent_insert_whatsapp_messages" ON public.whatsapp_messages;
CREATE POLICY "pex_agent_insert_whatsapp_messages"
  ON public.whatsapp_messages
  FOR INSERT
  TO pex_agent
  WITH CHECK (
    lead_id IS NOT NULL
    AND EXISTS (SELECT 1 FROM public.leads l WHERE l.id = lead_id)
    AND direction IN ('in', 'out')
  );

-- The WhatsApp 24h reply window is the one lead column the integration may write.
GRANT UPDATE (wa_window_expires_at) ON TABLE public.leads TO pex_agent;

DROP POLICY IF EXISTS "pex_agent_update_leads_wa_window" ON public.leads;
CREATE POLICY "pex_agent_update_leads_wa_window"
  ON public.leads
  FOR UPDATE
  TO pex_agent
  USING (true)
  WITH CHECK (true);

-- Sequences behind the two inserting tables.
DO $$
DECLARE
  seq text;
BEGIN
  FOREACH seq IN ARRAY ARRAY['emails_id_seq', 'whatsapp_messages_id_seq'] LOOP
    IF EXISTS (
      SELECT 1
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND c.relkind = 'S' AND c.relname = seq
    ) THEN
      EXECUTE format('GRANT USAGE, SELECT ON SEQUENCE public.%I TO pex_agent', seq);
    END IF;
  END LOOP;
END $$;

-- Staff names and emails behind the ids on a lead (sql/2026-10-29_partner_employee_contacts.sql).
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'partner_employee_contacts'
  ) THEN
    EXECUTE 'GRANT EXECUTE ON FUNCTION public.partner_employee_contacts(bigint[]) TO pex_agent';
    EXECUTE 'GRANT EXECUTE ON FUNCTION public.partner_lead_team(text) TO pex_agent';
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- The token
-- ---------------------------------------------------------------------------

/*
 * The partner authenticates with a JWT signed by the project's JWT secret (Dashboard → Settings →
 * API → JWT Settings) whose `role` claim is `pex_agent`:
 *
 *   {
 *     "role": "pex_agent",
 *     "iss": "rainmakerqueen-crm",
 *     "sub": "pex-integration",
 *     "iat": <now>,
 *     "exp": <now + 1 year>
 *   }
 *
 * Mint it outside this repository — anywhere the JWT secret can be pasted without being stored,
 * e.g. a one-off `node -e` with the `jsonwebtoken` package — and send it to the partner privately.
 * It is used exactly where the anon key is used today, in both headers:
 *
 *   apikey: <token>
 *   Authorization: Bearer <token>
 *
 * Rotating it later is minting a second token and letting the first expire. Revoking the
 * integration entirely is `REVOKE pex_agent FROM authenticator`, which no key of ours is affected
 * by.
 */

-- ---------------------------------------------------------------------------
-- Phase 2 — after the partner confirms it is calling with the new token
-- ---------------------------------------------------------------------------

/*
 * Run this block then, not now. It closes the public key's way into the client data.
 *
 * Checked first:
 *   - `emails`, `whatsapp_messages`, `lead_manual_interactions` and `tenants_employee` are read by
 *     no unauthenticated page of ours, so anon loses nothing it uses.
 *   - `leads` was read as anon by the contract signing page. It no longer is: that read moved to
 *     public.public_contract_client() in sql/2026-10-29_public_contract_client_rpc.sql, which
 *     answers only for a caller holding the link's token. Run that file and release the frontend
 *     carrying the change before the `leads` lines below, or a client mid-signature sees a
 *     contract with no name on it. No other unauthenticated page of ours reads the table.

REVOKE SELECT, INSERT ON public.emails FROM anon;
REVOKE SELECT, INSERT ON public.whatsapp_messages FROM anon;
REVOKE SELECT, INSERT ON public.lead_manual_interactions FROM anon;
REVOKE SELECT ON public.tenants_employee FROM anon;
REVOKE SELECT ON public.misc_leadsource FROM anon;
REVOKE SELECT ON public.misc_language FROM anon;
REVOKE UPDATE (wa_window_expires_at) ON TABLE public.leads FROM anon;

DROP POLICY IF EXISTS "pex_select_emails" ON public.emails;
DROP POLICY IF EXISTS "pex_insert_emails" ON public.emails;
DROP POLICY IF EXISTS "pex_select_whatsapp_messages" ON public.whatsapp_messages;
DROP POLICY IF EXISTS "pex_insert_whatsapp_messages" ON public.whatsapp_messages;
DROP POLICY IF EXISTS "pex_select_manual_interactions" ON public.lead_manual_interactions;
DROP POLICY IF EXISTS "pex_insert_manual_interactions" ON public.lead_manual_interactions;
DROP POLICY IF EXISTS "pex_read_employee_177" ON public.tenants_employee;
DROP POLICY IF EXISTS "pex_readonly" ON public.misc_leadsource;
DROP POLICY IF EXISTS "pex_readonly" ON public.misc_language;
DROP POLICY IF EXISTS "pex_update_leads_wa_window" ON public.leads;

REVOKE SELECT ON public.leads FROM anon;
DROP POLICY IF EXISTS "pex_readonly" ON public.leads;

 * Then confirm, as anon (a browser console on the public site is the honest test):
 *
 *   await supabase.from('leads').select('id').limit(1)        -- permission denied
 *   await supabase.from('emails').select('id').limit(1)       -- permission denied
 *   await supabase.from('whatsapp_messages').select('id')     -- permission denied
 *
 * and that a real /public-contract link still shows the client's name, and still signs.
 */
