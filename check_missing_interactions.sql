-- ============================================================================
-- STEP 1: Count missing interactions from src_leads_leadinteractions
-- ============================================================================
-- This counts interactions in src_leads_leadinteractions that don't exist in leads_leadinteractions
-- Matching is based on key fields: lead_id, date, time, content (since id format may differ)

SELECT 
    COUNT(*) as missing_interactions_count
FROM 
    src_leads_leadinteractions src
WHERE 
    NOT EXISTS (
        SELECT 1 
        FROM leads_leadinteractions ll 
        WHERE 
            -- Match by lead_id (convert text to bigint)
            (src.lead_id IS NOT NULL AND ll.lead_id IS NOT NULL AND ll.lead_id = CAST(src.lead_id AS bigint))
            -- Match by date and time to identify same interaction
            AND (src.date IS NULL OR ll.date = src.date)
            AND (src.time IS NULL OR ll.time = src.time)
            -- Match by content (first 100 chars to avoid issues with very long content)
            AND (src.content IS NULL OR LEFT(ll.content, 100) = LEFT(src.content, 100))
    )
    AND src.lead_id IS NOT NULL;

-- ============================================================================
-- STEP 2: Check for invalid foreign key references
-- ============================================================================
-- Check if interactions have lead_id that don't exist in leads_lead table

SELECT 
    COUNT(*) as interactions_with_invalid_lead_id
FROM 
    src_leads_leadinteractions src
WHERE 
    src.lead_id IS NOT NULL
    AND src.lead_id ~ '^[0-9]+$'  -- Only check numeric lead_ids
    AND NOT EXISTS (
        SELECT 1 
        FROM leads_lead ll 
        WHERE ll.id = CAST(src.lead_id AS bigint)
    );

-- ============================================================================
-- STEP 3: Count valid interactions that can be transferred
-- ============================================================================
-- This counts interactions that:
-- 1. Don't already exist in leads_leadinteractions
-- 2. Have valid lead_id (exists in leads_lead table)

SELECT 
    COUNT(*) as valid_interactions_to_transfer
FROM 
    src_leads_leadinteractions src
WHERE 
    src.lead_id IS NOT NULL
    AND src.lead_id ~ '^[0-9]+$'  -- Only numeric lead_ids
    AND EXISTS (
        SELECT 1 
        FROM leads_lead ll 
        WHERE ll.id = CAST(src.lead_id AS bigint)
    )
    AND NOT EXISTS (
        SELECT 1 
        FROM leads_leadinteractions ll 
        WHERE 
            (src.lead_id IS NOT NULL AND ll.lead_id IS NOT NULL AND ll.lead_id = CAST(src.lead_id AS bigint))
            AND (src.date IS NULL OR ll.date = src.date)
            AND (src.time IS NULL OR ll.time = src.time)
            AND (src.content IS NULL OR LEFT(ll.content, 100) = LEFT(src.content, 100))
    );

-- ============================================================================
-- STEP 4: List missing interactions with details
-- ============================================================================
-- This shows the actual missing interactions with their details

SELECT 
    src.id as src_id,
    src.lead_id,
    src.date,
    src.time,
    src.kind,
    src.direction,
    LEFT(src.content, 50) as content_preview,
    CASE 
        WHEN src.lead_id IS NULL THEN 'No lead_id'
        WHEN src.lead_id !~ '^[0-9]+$' THEN 'Non-numeric lead_id'
        WHEN NOT EXISTS (SELECT 1 FROM leads_lead ll WHERE ll.id = CAST(src.lead_id AS bigint))
        THEN 'Invalid lead_id (not in leads_lead)'
        WHEN EXISTS (
            SELECT 1 
            FROM leads_leadinteractions ll 
            WHERE 
                ll.lead_id = CAST(src.lead_id AS bigint)
                AND (src.date IS NULL OR ll.date = src.date)
                AND (src.time IS NULL OR ll.time = src.time)
                AND (src.content IS NULL OR LEFT(ll.content, 100) = LEFT(src.content, 100))
        )
        THEN 'Already exists'
        ELSE 'Can be transferred'
    END as status
FROM 
    src_leads_leadinteractions src
WHERE 
    src.lead_id IS NOT NULL
ORDER BY 
    CASE 
        WHEN src.lead_id ~ '^[0-9]+$' THEN CAST(src.lead_id AS bigint)
        ELSE 0
    END,
    src.date,
    src.time
LIMIT 100;

-- ============================================================================
-- STEP 5: Breakdown by lead_id validity
-- ============================================================================
-- See how many interactions have valid vs invalid lead_ids

SELECT 
    COUNT(*) as total_interactions,
    COUNT(CASE WHEN src.lead_id IS NULL THEN 1 END) as null_lead_id,
    COUNT(CASE WHEN src.lead_id IS NOT NULL AND src.lead_id !~ '^[0-9]+$' THEN 1 END) as non_numeric_lead_id,
    COUNT(CASE 
        WHEN src.lead_id IS NOT NULL 
        AND src.lead_id ~ '^[0-9]+$'
        AND EXISTS (SELECT 1 FROM leads_lead ll WHERE ll.id = CAST(src.lead_id AS bigint))
        THEN 1 
    END) as valid_lead_id,
    COUNT(CASE 
        WHEN src.lead_id IS NOT NULL 
        AND src.lead_id ~ '^[0-9]+$'
        AND NOT EXISTS (SELECT 1 FROM leads_lead ll WHERE ll.id = CAST(src.lead_id AS bigint))
        THEN 1 
    END) as invalid_lead_id
FROM 
    src_leads_leadinteractions src;

-- ============================================================================
-- STEP 6: Check for duplicate interactions (already exist)
-- ============================================================================
-- Count interactions that already exist in leads_leadinteractions

SELECT 
    COUNT(*) as already_existing_interactions
FROM 
    src_leads_leadinteractions src
WHERE 
    src.lead_id IS NOT NULL
    AND src.lead_id ~ '^[0-9]+$'
    AND EXISTS (
        SELECT 1 
        FROM leads_leadinteractions ll 
        WHERE 
            ll.lead_id = CAST(src.lead_id AS bigint)
            AND (src.date IS NULL OR ll.date = src.date)
            AND (src.time IS NULL OR ll.time = src.time)
            AND (src.content IS NULL OR LEFT(ll.content, 100) = LEFT(src.content, 100))
    );
