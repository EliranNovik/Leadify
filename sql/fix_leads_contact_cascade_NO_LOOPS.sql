-- SIMPLE FIX: Enable CASCADE DELETE for leads_contact table
-- NO LOOPS - Direct ALTER TABLE statements only
-- This avoids throttling issues

BEGIN;

-- ============================================
-- Step 1: Update emails table constraint
-- ============================================
-- Drop existing constraint (try common names)
ALTER TABLE public.emails DROP CONSTRAINT IF EXISTS emails_contact_id_fkey;
ALTER TABLE public.emails DROP CONSTRAINT IF EXISTS fk_emails_contact_id;
ALTER TABLE public.emails DROP CONSTRAINT IF EXISTS emails_contact_id_leads_contact_id_fk;

-- Add new constraint with CASCADE
ALTER TABLE public.emails 
ADD CONSTRAINT emails_contact_id_fkey 
FOREIGN KEY (contact_id) 
REFERENCES public.leads_contact(id) 
ON DELETE CASCADE;

-- ============================================
-- Step 2: Update lead_leadcontact table constraint
-- ============================================
-- Drop existing constraint
ALTER TABLE public.lead_leadcontact DROP CONSTRAINT IF EXISTS lead_leadcontact_contact_id_fkey;
ALTER TABLE public.lead_leadcontact DROP CONSTRAINT IF EXISTS fk_lead_leadcontact_contact_id;

-- Add new constraint with CASCADE
ALTER TABLE public.lead_leadcontact 
ADD CONSTRAINT lead_leadcontact_contact_id_fkey 
FOREIGN KEY (contact_id) 
REFERENCES public.leads_contact(id) 
ON DELETE CASCADE;

COMMIT;

-- ============================================
-- Verification query (run separately if needed)
-- ============================================
-- SELECT
--     tc.table_name,
--     kcu.column_name,
--     tc.constraint_name,
--     rc.delete_rule,
--     CASE WHEN rc.delete_rule = 'CASCADE' THEN '✓' ELSE '✗' END as status
-- FROM 
--     information_schema.table_constraints AS tc
--     JOIN information_schema.key_column_usage AS kcu
--       ON tc.constraint_name = kcu.constraint_name
--     JOIN information_schema.referential_constraints AS rc
--       ON tc.constraint_name = rc.constraint_name
--     JOIN information_schema.constraint_column_usage AS ccu
--       ON ccu.constraint_name = tc.constraint_name
-- WHERE 
--     tc.constraint_type = 'FOREIGN KEY'
--     AND ccu.table_name = 'leads_contact'
--     AND tc.table_schema = 'public'
-- ORDER BY tc.table_name, kcu.column_name;

-- ============================================
-- After running this script, you can:
-- ============================================
-- TRUNCATE TABLE leads_contact CASCADE;
-- OR
-- DELETE FROM leads_contact;

