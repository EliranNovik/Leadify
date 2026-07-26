-- Ensure public business-card RPC is executable by backend service role.
-- Safe to re-run.

GRANT EXECUTE ON FUNCTION public.get_public_business_card(BIGINT) TO anon, authenticated, service_role;
