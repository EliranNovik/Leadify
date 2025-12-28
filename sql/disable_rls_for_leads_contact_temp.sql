-- Temporarily disable RLS on leads_contact to allow deletion
-- USE WITH CAUTION: This removes all access controls
-- Remember to re-enable RLS after your operation

BEGIN;

-- Disable RLS temporarily
ALTER TABLE public.leads_contact DISABLE ROW LEVEL SECURITY;

COMMIT;

-- ============================================
-- After you're done with deletion, re-enable RLS:
-- ============================================
-- ALTER TABLE public.leads_contact ENABLE ROW LEVEL SECURITY;
-- 
-- Then run the enable_leads_contact_deletion_rls.sql script to set up proper policies

