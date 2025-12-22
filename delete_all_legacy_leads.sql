-- ============================================
-- DELETE ALL LEGACY LEADS FROM leads_lead TABLE
-- ============================================
-- This script will delete all records from leads_lead
-- Since CASCADE is enabled, all related records will be automatically deleted
-- ============================================

-- ============================================
-- STEP 1: CHECK WHAT WILL BE DELETED
-- ============================================

-- Total legacy leads count
SELECT 
    '📊 Total legacy leads' as info,
    COUNT(*) as count
FROM leads_lead;

-- Breakdown by stage
SELECT 
    '📊 Breakdown by stage' as info,
    ls.name as stage_name,
    ll.stage as stage_id,
    COUNT(*) as lead_count
FROM leads_lead ll
LEFT JOIN lead_stages ls ON ll.stage = ls.id
GROUP BY ll.stage, ls.name
ORDER BY COUNT(*) DESC;

-- Breakdown by date ranges
SELECT 
    '📊 Breakdown by creation date' as info,
    CASE 
        WHEN cdate >= NOW() - INTERVAL '1 month' THEN '🟢 Last 30 days'
        WHEN cdate >= NOW() - INTERVAL '3 months' THEN '🟡 Last 3 months'
        WHEN cdate >= NOW() - INTERVAL '6 months' THEN '🟠 Last 6 months'
        WHEN cdate >= NOW() - INTERVAL '1 year' THEN '🔵 Last year'
        ELSE '🔴 Older than 1 year'
    END as date_range,
    COUNT(*) as count
FROM leads_lead
GROUP BY date_range
ORDER BY date_range;

-- Related records that will be CASCADE deleted
-- Note: Exact counts may vary based on your database structure
-- CASCADE will automatically handle all foreign key relationships
SELECT 
    '⚠️ RELATED RECORDS WILL BE AUTO-DELETED BY CASCADE' as warning,
    'Check the foreign key relationships to see which tables will be affected' as info;

-- To see exact counts, run check_related_tables_columns.sql first
-- to identify the correct column names for your database

-- ============================================
-- STEP 2: DELETE ALL LEGACY LEADS
-- ============================================

-- 🛑 UNCOMMENT THE SECTION BELOW TO ACTUALLY DELETE 🛑
-- Review the counts above first!
-- This is wrapped in a transaction for safety

/*
BEGIN;

-- Delete all legacy leads (CASCADE will handle related records)
DELETE FROM leads_lead;

-- Verify deletion
SELECT 
    '✅ Deletion complete' as status,
    COUNT(*) as remaining_legacy_leads
FROM leads_lead;

-- If you're happy with the result, COMMIT
COMMIT;

-- If something went wrong, ROLLBACK
-- ROLLBACK;
*/

-- ============================================
-- ALTERNATIVE: DELETE BY CRITERIA
-- ============================================

-- 🔹 OPTION A: Delete only dropped leads (stage 91)
/*
BEGIN;
DELETE FROM leads_lead WHERE stage = 91;
SELECT '✅ Dropped leads deleted' as status, COUNT(*) as remaining FROM leads_lead;
COMMIT;
*/

-- 🔹 OPTION B: Delete leads older than 1 year
/*
BEGIN;
DELETE FROM leads_lead WHERE cdate < NOW() - INTERVAL '1 year';
SELECT '✅ Old leads deleted' as status, COUNT(*) as remaining FROM leads_lead;
COMMIT;
*/

-- 🔹 OPTION C: Delete leads in specific stage range (e.g., stage < 10)
/*
BEGIN;
DELETE FROM leads_lead WHERE stage < 10;
SELECT '✅ Early stage leads deleted' as status, COUNT(*) as remaining FROM leads_lead;
COMMIT;
*/

-- 🔹 OPTION D: Delete leads without a specific field (e.g., no email)
/*
BEGIN;
DELETE FROM leads_lead WHERE email IS NULL OR email = '';
SELECT '✅ Leads without email deleted' as status, COUNT(*) as remaining FROM leads_lead;
COMMIT;
*/

-- 🔹 OPTION E: Delete leads by ID range
/*
BEGIN;
DELETE FROM leads_lead WHERE id BETWEEN 100000 AND 120000;
SELECT '✅ Leads in ID range deleted' as status, COUNT(*) as remaining FROM leads_lead;
COMMIT;
*/

-- 🔹 OPTION F: Delete ALL legacy leads (use with caution!)
/*
BEGIN;
DELETE FROM leads_lead;
SELECT '✅ ALL legacy leads deleted' as status, COUNT(*) as remaining FROM leads_lead;
COMMIT;
*/

-- ============================================
-- STEP 3: VERIFY CASCADE DELETIONS WORKED
-- ============================================

-- After deletion, verify the main table is empty
/*
SELECT 
    '✅ Verification - Legacy Leads Table' as status,
    COUNT(*) as remaining_legacy_leads,
    CASE 
        WHEN COUNT(*) = 0 THEN '🎉 All legacy leads deleted successfully!'
        ELSE '⚠️ Some legacy leads remain'
    END as message
FROM leads_lead;
*/

-- ============================================
-- NOTES
-- ============================================

-- ⚠️ IMPORTANT REMINDERS:
-- 1. Always review the counts in STEP 1 before deleting
-- 2. Uncomment only ONE delete option at a time
-- 3. Test with a small batch first if you're unsure
-- 4. The transaction can be rolled back if something goes wrong
-- 5. CASCADE will automatically delete related records in:
--    - follow_ups
--    - leads_lead_tags
--    - meetings
--    - proformas
--    - whatsapp_messages
--    - and other related tables
-- 6. Make sure you have a backup before running this!

-- ============================================
-- RESET AUTO-INCREMENT (OPTIONAL)
-- ============================================

-- If you want to reset the sequence after deleting all leads:
/*
-- Check current sequence value
SELECT 
    'Current sequence value' as info,
    last_value 
FROM leads_lead_id_seq;

-- Reset sequence to start from 1 (only if table is empty!)
-- ALTER SEQUENCE leads_lead_id_seq RESTART WITH 1;
*/

