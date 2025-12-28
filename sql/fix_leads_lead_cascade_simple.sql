-- Simple script to enable CASCADE DELETE for leads_lead table
-- This is a more straightforward approach that handles the most common foreign keys

BEGIN;

-- ============================================
-- Update meetings table foreign key
-- ============================================
ALTER TABLE public.meetings 
DROP CONSTRAINT IF EXISTS meetings_legacy_lead_id_fkey;

ALTER TABLE public.meetings 
ADD CONSTRAINT meetings_legacy_lead_id_fkey 
FOREIGN KEY (legacy_lead_id) 
REFERENCES public.leads_lead(id) 
ON DELETE CASCADE;

-- ============================================
-- Update lead_leadcontact table foreign key
-- ============================================
ALTER TABLE public.lead_leadcontact 
DROP CONSTRAINT IF EXISTS lead_leadcontact_lead_id_fkey;

ALTER TABLE public.lead_leadcontact 
ADD CONSTRAINT lead_leadcontact_lead_id_fkey 
FOREIGN KEY (lead_id) 
REFERENCES public.leads_lead(id) 
ON DELETE CASCADE;

-- ============================================
-- Update leads_leadstage table foreign key
-- ============================================
ALTER TABLE public.leads_leadstage 
DROP CONSTRAINT IF EXISTS leads_leadstage_lead_id_fkey;

ALTER TABLE public.leads_leadstage 
ADD CONSTRAINT leads_leadstage_lead_id_fkey 
FOREIGN KEY (lead_id) 
REFERENCES public.leads_lead(id) 
ON DELETE CASCADE;

-- ============================================
-- Update user_highlights table foreign key
-- ============================================
ALTER TABLE public.user_highlights 
DROP CONSTRAINT IF EXISTS user_highlights_lead_id_fkey;

ALTER TABLE public.user_highlights 
ADD CONSTRAINT user_highlights_lead_id_fkey 
FOREIGN KEY (lead_id) 
REFERENCES public.leads_lead(id) 
ON DELETE CASCADE;

-- ============================================
-- Handle any other foreign keys dynamically
-- ============================================
-- This will catch any foreign keys that weren't explicitly handled above
DO $$
DECLARE
    fk_record RECORD;
BEGIN
    FOR fk_record IN
        SELECT 
            tc.table_schema,
            tc.table_name,
            kcu.column_name,
            tc.constraint_name,
            ccu.column_name AS ref_column
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
            AND tc.table_name NOT IN ('meetings', 'lead_leadcontact', 'leads_leadstage', 'user_highlights')
            AND NOT EXISTS (
                SELECT 1 FROM information_schema.referential_constraints rc2
                WHERE rc2.constraint_name = tc.constraint_name
                AND rc2.delete_rule = 'CASCADE'
            )
    LOOP
        EXECUTE format(
            'ALTER TABLE %I.%I DROP CONSTRAINT IF EXISTS %I',
            fk_record.table_schema,
            fk_record.table_name,
            fk_record.constraint_name
        );
        
        EXECUTE format(
            'ALTER TABLE %I.%I ADD CONSTRAINT %I FOREIGN KEY (%I) REFERENCES %I.leads_lead(%I) ON DELETE CASCADE',
            fk_record.table_schema,
            fk_record.table_name,
            fk_record.constraint_name,
            fk_record.column_name,
            fk_record.table_schema,
            fk_record.ref_column
        );
        
        RAISE NOTICE 'Updated % on table %', fk_record.constraint_name, fk_record.table_name;
    END LOOP;
END $$;

-- ============================================
-- Verify all constraints use CASCADE
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
ORDER BY tc.table_name;

COMMIT;

