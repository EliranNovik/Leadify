-- Script to delete all new leads from the leads table
-- This will delete records from all dependent tables first

-- WARNING: This will delete ALL data from the leads table and related records
-- Make sure you have a backup before running this!

-- Start a transaction for safety
BEGIN;

-- 1. Delete from leads_leadstage (stage history)
DELETE FROM leads_leadstage WHERE newlead_id IS NOT NULL;

-- 2. Delete from follow_ups
DELETE FROM follow_ups WHERE new_lead_id IS NOT NULL;

-- 3. Delete from meetings
DELETE FROM meetings WHERE client_id IS NOT NULL;

-- 4. Delete from emails
DELETE FROM emails WHERE lead_id IS NOT NULL;

-- 5. Delete from whatsapp_messages (if it references leads)
DELETE FROM whatsapp_messages WHERE lead_id IS NOT NULL;

-- 6. Delete from contacts
DELETE FROM contacts WHERE lead_id IS NOT NULL;

-- 7. Delete from user_highlights
DELETE FROM user_highlights WHERE lead_id IS NOT NULL;

-- 8. Delete from lead_changes
DELETE FROM lead_changes WHERE lead_id IS NOT NULL;

-- 9. Delete from payment_plan_changes (if it exists)
DELETE FROM payment_plan_changes WHERE lead_id IS NOT NULL;

-- 10. Delete from finance_changes_history (if it references leads)
DELETE FROM finance_changes_history WHERE lead_id IS NOT NULL;

-- 11. Finally, delete all records from leads table
DELETE FROM leads;

-- If everything looks good, commit the transaction
-- COMMIT;

-- If something went wrong, rollback
-- ROLLBACK;

-- Check counts after deletion (uncomment after COMMIT)
-- SELECT 'leads' as table_name, COUNT(*) as count FROM leads
-- UNION ALL
-- SELECT 'leads_leadstage', COUNT(*) FROM leads_leadstage WHERE newlead_id IS NOT NULL
-- UNION ALL
-- SELECT 'follow_ups', COUNT(*) FROM follow_ups WHERE new_lead_id IS NOT NULL
-- UNION ALL
-- SELECT 'meetings', COUNT(*) FROM meetings WHERE client_id IS NOT NULL;

