-- Enable CASCADE DELETE for all foreign keys that reference leads table
-- This script targets only the tables that currently have NO ACTION or SET NULL

BEGIN;

-- ============================================
-- UPDATE FOREIGN KEYS TO CASCADE
-- ============================================

-- 1. departments table
ALTER TABLE departments 
DROP CONSTRAINT IF EXISTS departments_lead_id_fkey;

ALTER TABLE departments 
ADD CONSTRAINT departments_lead_id_fkey 
FOREIGN KEY (lead_id) 
REFERENCES leads(id) 
ON DELETE CASCADE;

-- 2. employees table
ALTER TABLE employees 
DROP CONSTRAINT IF EXISTS employees_lead_id_fkey;

ALTER TABLE employees 
ADD CONSTRAINT employees_lead_id_fkey 
FOREIGN KEY (lead_id) 
REFERENCES leads(id) 
ON DELETE CASCADE;

-- 3. follow_ups table
ALTER TABLE follow_ups 
DROP CONSTRAINT IF EXISTS follow_ups_new_lead_id_fkey;

ALTER TABLE follow_ups 
ADD CONSTRAINT follow_ups_new_lead_id_fkey 
FOREIGN KEY (new_lead_id) 
REFERENCES leads(id) 
ON DELETE CASCADE;

-- 4. lead_leadcontact table
ALTER TABLE lead_leadcontact 
DROP CONSTRAINT IF EXISTS lead_leadcontact_newlead_id_fkey;

ALTER TABLE lead_leadcontact 
ADD CONSTRAINT lead_leadcontact_newlead_id_fkey 
FOREIGN KEY (newlead_id) 
REFERENCES leads(id) 
ON DELETE CASCADE;

-- 5. leads_contact table
ALTER TABLE leads_contact 
DROP CONSTRAINT IF EXISTS leads_contact_newlead_id_fkey;

ALTER TABLE leads_contact 
ADD CONSTRAINT leads_contact_newlead_id_fkey 
FOREIGN KEY (newlead_id) 
REFERENCES leads(id) 
ON DELETE CASCADE;

-- 6. leads_lead_tags table
ALTER TABLE leads_lead_tags 
DROP CONSTRAINT IF EXISTS leads_lead_tags_newlead_id_fkey;

ALTER TABLE leads_lead_tags 
ADD CONSTRAINT leads_lead_tags_newlead_id_fkey 
FOREIGN KEY (newlead_id) 
REFERENCES leads(id) 
ON DELETE CASCADE;

-- 7. leads_leadstage table (IMPORTANT - this is causing the main error!)
ALTER TABLE leads_leadstage 
DROP CONSTRAINT IF EXISTS leads_leadstage_newlead_id_fkey;

ALTER TABLE leads_leadstage 
ADD CONSTRAINT leads_leadstage_newlead_id_fkey 
FOREIGN KEY (newlead_id) 
REFERENCES leads(id) 
ON DELETE CASCADE;

-- 8. payment_plan_changes table
ALTER TABLE payment_plan_changes 
DROP CONSTRAINT IF EXISTS payment_plan_changes_lead_id_fkey;

ALTER TABLE payment_plan_changes 
ADD CONSTRAINT payment_plan_changes_lead_id_fkey 
FOREIGN KEY (lead_id) 
REFERENCES leads(id) 
ON DELETE CASCADE;

-- OPTIONAL: Change ai_chat_history from SET NULL to CASCADE
-- Uncomment if you want to delete chat history when lead is deleted
-- ALTER TABLE ai_chat_history 
-- DROP CONSTRAINT IF EXISTS ai_chat_history_lead_id_fkey;
-- 
-- ALTER TABLE ai_chat_history 
-- ADD CONSTRAINT ai_chat_history_lead_id_fkey 
-- FOREIGN KEY (lead_id) 
-- REFERENCES leads(id) 
-- ON DELETE CASCADE;

-- If everything looks good, commit
COMMIT;

-- ============================================
-- VERIFY THE CHANGES
-- ============================================

-- After committing, run this to verify:
SELECT
    tc.table_name,
    kcu.column_name,
    rc.delete_rule,
    CASE 
        WHEN rc.delete_rule = 'CASCADE' THEN '✓ CASCADE enabled'
        ELSE '✗ No CASCADE (' || rc.delete_rule || ')'
    END as status
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
    AND ccu.table_name = 'leads'
    AND tc.table_schema = 'public'
ORDER BY tc.table_name;

-- ============================================
-- NOW YOU CAN EASILY DELETE LEADS
-- ============================================

-- After CASCADE is enabled, you can simply run:
-- DELETE FROM leads;

-- Or delete specific leads:
-- DELETE FROM leads WHERE stage = 91;  -- Example: delete dropped leads
-- DELETE FROM leads WHERE created_at < '2024-01-01';  -- Example: delete old leads
-- DELETE FROM leads WHERE id = 'some-uuid';  -- Delete specific lead

