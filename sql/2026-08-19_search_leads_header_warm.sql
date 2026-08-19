-- Header search: cheaper warmup + longer cold-start budget.
-- Safe to re-run. Does not replace search_leads_header SQL body.
--
-- Run in Supabase SQL editor OR:
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f sql/2026-08-19_search_leads_header_warm.sql

SET statement_timeout TO '0';

-- Cold first typed query was dying at 2.5s on the client before Postgres finished.
ALTER FUNCTION public.search_leads_header(text, integer, text[])
  SET statement_timeout = '4s';

CREATE OR REPLACE FUNCTION public.search_leads_header_warm()
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
SET row_security = off
SET statement_timeout = '2s'
AS $$
BEGIN
  -- Touch the tables the header RPC uses so pages/indexes are in cache.
  PERFORM 1 FROM public.leads WHERE name IS NOT NULL LIMIT 1;
  PERFORM 1 FROM public.leads_lead WHERE name IS NOT NULL LIMIT 1;
  PERFORM 1 FROM public.leads_contact WHERE name IS NOT NULL LIMIT 1;
  PERFORM 1 FROM public.leads WHERE lead_number IS NOT NULL LIMIT 1;
  PERFORM 1 FROM public.leads_lead WHERE lead_number IS NOT NULL LIMIT 1;
  RETURN true;
END;
$$;

GRANT EXECUTE ON FUNCTION public.search_leads_header_warm()
  TO anon, authenticated, service_role;

NOTIFY pgrst, 'reload schema';
