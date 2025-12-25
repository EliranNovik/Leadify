-- Delete duplicate emails where the same message_id is saved multiple times for the same legacy_id
-- 
-- IMPORTANT: Run the SELECT queries first to preview what will be deleted!

-- ============================================
-- PREVIEW: Check duplicates that will be deleted
-- ============================================

-- Preview duplicate emails by message_id and legacy_id
WITH duplicates AS (
    SELECT 
        message_id,
        legacy_id,
        COUNT(*) as duplicate_count,
        MIN(id) as keep_id
    FROM emails
    WHERE legacy_id IS NOT NULL
      AND message_id IS NOT NULL
    GROUP BY message_id, legacy_id
    HAVING COUNT(*) > 1
)
SELECT 
    d.message_id,
    d.legacy_id,
    d.duplicate_count,
    d.keep_id,
    ARRAY_AGG(e.id ORDER BY e.id) as delete_ids,
    ARRAY_AGG(e.id ORDER BY e.id) as all_ids
FROM duplicates d
INNER JOIN emails e ON e.message_id = d.message_id AND e.legacy_id = d.legacy_id
WHERE e.id != d.keep_id
GROUP BY d.message_id, d.legacy_id, d.duplicate_count, d.keep_id
ORDER BY d.duplicate_count DESC, d.message_id;

-- Count summary
SELECT 
    'Total duplicate groups' as description,
    COUNT(*) as count,
    SUM(duplicate_count - 1) as total_duplicates_to_delete
FROM (
    SELECT 
        message_id,
        legacy_id,
        COUNT(*) as duplicate_count
    FROM emails
    WHERE legacy_id IS NOT NULL
      AND message_id IS NOT NULL
    GROUP BY message_id, legacy_id
    HAVING COUNT(*) > 1
) duplicates;

-- ============================================
-- DELETE QUERY (Uncomment to execute)
-- ============================================
-- This keeps the email with the lowest id and deletes the rest

-- DELETE FROM emails
-- WHERE id IN (
--     SELECT e.id
--     FROM emails e
--     INNER JOIN (
--         SELECT 
--             message_id,
--             legacy_id,
--             MIN(id) as keep_id
--         FROM emails
--         WHERE legacy_id IS NOT NULL
--           AND message_id IS NOT NULL
--         GROUP BY message_id, legacy_id
--         HAVING COUNT(*) > 1
--     ) keep ON e.message_id = keep.message_id 
--            AND e.legacy_id = keep.legacy_id
--     WHERE e.id != keep.keep_id
-- );

-- ============================================
-- VERIFICATION: After deletion, verify no duplicates remain
-- ============================================
-- Run this after deletion to confirm all duplicates were removed

-- SELECT 
--     'Remaining duplicates' as check_type,
--     COUNT(*) as count
-- FROM (
--     SELECT 
--         message_id,
--         legacy_id,
--         COUNT(*) as duplicate_count
--     FROM emails
--     WHERE legacy_id IS NOT NULL
--       AND message_id IS NOT NULL
--     GROUP BY message_id, legacy_id
--     HAVING COUNT(*) > 1
-- ) remaining_duplicates;

