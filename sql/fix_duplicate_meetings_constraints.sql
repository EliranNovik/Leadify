-- Fix duplicate foreign key constraints on meetings.legacy_lead_id
-- Having duplicate constraints can cause TRUNCATE issues even if both are CASCADE

BEGIN;

-- ============================================
-- Step 1: Check for duplicate constraints
-- ============================================
SELECT 
    tc.table_name,
    kcu.column_name,
    tc.constraint_name,
    rc.delete_rule
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
    AND tc.table_name = 'meetings'
ORDER BY tc.constraint_name;

-- ============================================
-- Step 2: Remove duplicate constraints, keep only one
-- ============================================
-- Drop the duplicate constraint (keep meetings_legacy_lead_id_fkey, drop fk_meetings_legacy_lead)
ALTER TABLE public.meetings 
DROP CONSTRAINT IF EXISTS fk_meetings_legacy_lead;

-- Verify the remaining constraint has CASCADE
ALTER TABLE public.meetings 
DROP CONSTRAINT IF EXISTS meetings_legacy_lead_id_fkey;

ALTER TABLE public.meetings 
ADD CONSTRAINT meetings_legacy_lead_id_fkey 
FOREIGN KEY (legacy_lead_id) 
REFERENCES public.leads_lead(id) 
ON DELETE CASCADE;

-- ============================================
-- Step 3: Also check lead_leadcontact for duplicates
-- ============================================
-- Drop duplicate constraint on lead_leadcontact if it exists
ALTER TABLE public.lead_leadcontact 
DROP CONSTRAINT IF EXISTS fk_lead_leadcontact_lead_id;

-- Keep only lead_leadcontact_lead_id_fkey and ensure it's CASCADE
ALTER TABLE public.lead_leadcontact 
DROP CONSTRAINT IF EXISTS lead_leadcontact_lead_id_fkey;

ALTER TABLE public.lead_leadcontact 
ADD CONSTRAINT lead_leadcontact_lead_id_fkey 
FOREIGN KEY (lead_id) 
REFERENCES public.leads_lead(id) 
ON DELETE CASCADE;

-- ============================================
-- Step 4: Verify no duplicates remain
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
-- After running this, try:
-- ============================================
-- TRUNCATE TABLE leads_lead CASCADE;
--
-- OR
--
-- DELETE FROM leads_lead;

