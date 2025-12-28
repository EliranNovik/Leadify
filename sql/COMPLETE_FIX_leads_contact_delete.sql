-- COMPLETE FIX: Enable deletion from leads_contact table
-- This script handles both foreign key constraints AND RLS policies
-- IMPORTANT: Make sure you're running this as the "postgres" role in Supabase SQL Editor

BEGIN;

-- ============================================
-- STEP 1: Fix foreign key constraints (CASCADE)
-- ============================================

-- Update emails table constraint
ALTER TABLE public.emails DROP CONSTRAINT IF EXISTS emails_contact_id_fkey;
ALTER TABLE public.emails DROP CONSTRAINT IF EXISTS fk_emails_contact_id;
ALTER TABLE public.emails DROP CONSTRAINT IF EXISTS emails_contact_id_leads_contact_id_fk;

ALTER TABLE public.emails 
ADD CONSTRAINT emails_contact_id_fkey 
FOREIGN KEY (contact_id) 
REFERENCES public.leads_contact(id) 
ON DELETE CASCADE;

-- Update lead_leadcontact table constraint
ALTER TABLE public.lead_leadcontact DROP CONSTRAINT IF EXISTS lead_leadcontact_contact_id_fkey;
ALTER TABLE public.lead_leadcontact DROP CONSTRAINT IF EXISTS fk_lead_leadcontact_contact_id;

ALTER TABLE public.lead_leadcontact 
ADD CONSTRAINT lead_leadcontact_contact_id_fkey 
FOREIGN KEY (contact_id) 
REFERENCES public.leads_contact(id) 
ON DELETE CASCADE;

-- ============================================
-- STEP 2: Temporarily disable RLS to allow deletion
-- ============================================
-- This removes access control temporarily so you can delete
ALTER TABLE public.leads_contact DISABLE ROW LEVEL SECURITY;

COMMIT;

-- ============================================
-- After running this script:
-- ============================================
-- You should now be able to run:
-- DELETE FROM leads_contact;
-- 
-- OR
--
-- TRUNCATE TABLE leads_contact CASCADE;
--
-- ============================================
-- OPTIONAL: Re-enable RLS after deletion (run separately)
-- ============================================
-- After you're done deleting, you can re-enable RLS and set up proper policies:
--
-- ALTER TABLE public.leads_contact ENABLE ROW LEVEL SECURITY;
--
-- Then run: enable_leads_contact_deletion_rls.sql

