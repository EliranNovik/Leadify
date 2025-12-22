-- ============================================
-- SIMPLE: DELETE ALL LEGACY LEADS
-- ============================================
-- This is a streamlined version without complex checks
-- CASCADE will automatically delete all related records
-- ============================================

-- STEP 1: Check how many legacy leads exist
SELECT 
    '📊 Current legacy leads count' as info,
    COUNT(*) as total_legacy_leads
FROM leads_lead;

-- STEP 2: (Optional) See breakdown by stage
SELECT 
    stage,
    COUNT(*) as count
FROM leads_lead
GROUP BY stage
ORDER BY stage;

-- ============================================
-- STEP 3: DELETE ALL LEGACY LEADS
-- ============================================

-- 🛑 UNCOMMENT TO DELETE ALL LEGACY LEADS 🛑

/*
BEGIN;

-- Delete all legacy leads
DELETE FROM leads_lead;

-- Verify deletion
SELECT 
    '✅ Deletion Result' as status,
    COUNT(*) as remaining_legacy_leads,
    CASE 
        WHEN COUNT(*) = 0 THEN '🎉 SUCCESS - All deleted!'
        ELSE '⚠️ Some records remain'
    END as message
FROM leads_lead;

-- If happy with result: COMMIT
COMMIT;

-- If something went wrong: ROLLBACK
-- ROLLBACK;
*/

-- ============================================
-- ALTERNATIVE: DELETE ONLY SPECIFIC LEADS
-- ============================================

-- Example 1: Delete only dropped leads (stage 91)
/*
BEGIN;
DELETE FROM leads_lead WHERE stage = 91;
COMMIT;
*/

-- Example 2: Delete leads older than specific date
/*
BEGIN;
DELETE FROM leads_lead WHERE cdate < '2024-01-01';
COMMIT;
*/

-- Example 3: Delete by ID range
/*
BEGIN;
DELETE FROM leads_lead WHERE id < 100000;
COMMIT;
*/

