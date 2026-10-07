-- Let signed-in users edit leads again (public.leads).
--
-- Row-level security was switched on for this table by 2026-09-06_leads_wa_window_expires_at.sql,
-- which needed it so PEX (the anon role) could write wa_window_expires_at and nothing else. That
-- migration added an UPDATE policy for `anon` only. Nothing in this repo has ever added one for
-- `authenticated`, so once RLS was active every UPDATE from the app matched zero rows.
--
-- The failure is silent, which is why it went unnoticed: Postgres raises no error for a row the
-- USING clause hides, and supabase-js reports {data: null, error: null} for an `.update()` with no
-- `.select()`. The Roles tab showed "Roles saved successfully" over a write that never happened.
--
-- The policy below is unconditional for signed-in users, which is the access the app had before RLS
-- was enabled, so this restores the previous behaviour rather than widening it. Narrow it later if
-- leads should be restricted per user.

-- Step 1: report what is actually in place, so the repair below can be judged against it.
DO $$
DECLARE
  rls_on boolean;
  pol record;
  authenticated_update_policies int;
BEGIN
  SELECT relrowsecurity INTO rls_on
  FROM pg_class
  WHERE oid = 'public.leads'::regclass;

  RAISE NOTICE 'row level security on public.leads: %', CASE WHEN rls_on THEN 'ENABLED' ELSE 'disabled' END;

  RAISE NOTICE '--- existing policies on public.leads ---';
  FOR pol IN
    SELECT policyname, cmd, roles::text AS roles, permissive
    FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'leads'
    ORDER BY cmd, policyname
  LOOP
    RAISE NOTICE '  % | % | roles=% | %', pol.cmd, pol.policyname, pol.roles, pol.permissive;
  END LOOP;

  -- A policy for cmd ALL covers UPDATE too, and one granted to PUBLIC covers authenticated.
  SELECT count(*) INTO authenticated_update_policies
  FROM pg_policies
  WHERE schemaname = 'public'
    AND tablename = 'leads'
    AND permissive = 'PERMISSIVE'
    AND cmd IN ('ALL', 'UPDATE')
    AND ('authenticated' = ANY (roles) OR 'public' = ANY (roles));

  IF authenticated_update_policies = 0 THEN
    RAISE NOTICE 'No UPDATE policy applies to `authenticated`: this is the cause of the silent no-op.';
  ELSE
    RAISE NOTICE 'An UPDATE policy already applies to `authenticated` (% found); look elsewhere for the cause.', authenticated_update_policies;
  END IF;
END $$;

-- Step 2: the policy itself. Safe to re-run, and harmless if a working policy already exists.
DROP POLICY IF EXISTS "Authenticated can update leads" ON public.leads;
CREATE POLICY "Authenticated can update leads"
  ON public.leads
  FOR UPDATE
  TO authenticated
  USING (auth.uid() IS NOT NULL)
  WITH CHECK (auth.uid() IS NOT NULL);

-- The earlier migration revoked table-wide UPDATE from anon; authenticated still needs the grant,
-- since a policy permits a row but a grant is what permits the statement.
GRANT SELECT, UPDATE ON public.leads TO authenticated;

-- Step 3: verify. Expect the new policy alongside the anon wa_window one.
SELECT
  policyname,
  cmd,
  roles::text AS roles,
  permissive,
  qual AS using_expression,
  with_check AS with_check_expression
FROM pg_policies
WHERE schemaname = 'public' AND tablename = 'leads'
ORDER BY cmd, policyname;
