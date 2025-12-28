-- Remove duplicate foreign key constraints and ensure CASCADE is set
-- Duplicate constraints can prevent TRUNCATE from working properly

BEGIN;

-- ============================================
-- Step 1: Remove duplicate constraint on meetings.legacy_lead_id
-- ============================================
-- Keep meetings_legacy_lead_id_fkey, remove fk_meetings_legacy_lead
ALTER TABLE public.meetings 
DROP CONSTRAINT IF EXISTS fk_meetings_legacy_lead;

-- Ensure the remaining constraint has CASCADE
ALTER TABLE public.meetings 
DROP CONSTRAINT IF EXISTS meetings_legacy_lead_id_fkey;

ALTER TABLE public.meetings 
ADD CONSTRAINT meetings_legacy_lead_id_fkey 
FOREIGN KEY (legacy_lead_id) 
REFERENCES public.leads_lead(id) 
ON DELETE CASCADE;

-- ============================================
-- Step 2: Remove duplicate constraint on lead_leadcontact.lead_id
-- ============================================
-- Keep lead_leadcontact_lead_id_fkey, remove fk_lead_leadcontact_lead_id
ALTER TABLE public.lead_leadcontact 
DROP CONSTRAINT IF EXISTS fk_lead_leadcontact_lead_id;

-- Ensure the remaining constraint has CASCADE
ALTER TABLE public.lead_leadcontact 
DROP CONSTRAINT IF EXISTS lead_leadcontact_lead_id_fkey;

ALTER TABLE public.lead_leadcontact 
ADD CONSTRAINT lead_leadcontact_lead_id_fkey 
FOREIGN KEY (lead_id) 
REFERENCES public.leads_lead(id) 
ON DELETE CASCADE;

-- ============================================
-- Step 3: Verify no duplicates remain
-- ============================================
SELECT 
    tc.table_name,
    kcu.column_name,
    COUNT(*) as constraint_count,
    string_agg(tc.constraint_name, ', ' ORDER BY tc.constraint_name) as constraint_names
FROM 
    information_schema.table_constraints AS tc
    JOIN information_schema.key_column_usage AS kcu
      ON tc.constraint_name = kcu.constraint_name
    JOIN information_schema.constraint_column_usage AS ccu
      ON ccu.constraint_name = tc.constraint_name
WHERE 
    tc.constraint_type = 'FOREIGN KEY'
    AND ccu.table_name = 'leads_lead'
    AND tc.table_schema = 'public'
GROUP BY tc.table_name, kcu.column_name
HAVING COUNT(*) > 1;

-- ============================================
-- Step 4: Final verification - all constraints should be CASCADE
-- ============================================
SELECT 
    tc.table_name,
    kcu.column_name,
    tc.constraint_name,
    rc.delete_rule,
    CASE WHEN rc.delete_rule = 'CASCADE' THEN '✓' ELSE '✗' END as status
FROM 
    information_schema.table_constraints AS tc
    JOIN information_schema.key_column_usage AS kcu
      ON tc.constraint_name = kcu.constraint_name
    JOIN information_schema.referential_constraints AS rc
      ON tc.constraint_name = rc.constraint_name
    JOIN information_schema.constraint_column_usage AS ccu
      ON ccu.constraint_name = tc.constraint_name
WHERE 
    tc.constraint_type = 'FOREIGN KEY'
    AND ccu.table_name = 'leads_lead'
    AND tc.table_schema = 'public'
ORDER BY tc.table_name, kcu.column_name, tc.constraint_name;

COMMIT;

-- ============================================
-- After running this script:
-- ============================================
-- You should now be able to run:
-- TRUNCATE TABLE leads_lead CASCADE;
--
-- OR
--
-- DELETE FROM leads_lead;

