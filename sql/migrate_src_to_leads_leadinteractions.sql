-- Migration script to copy missing entries from src_leads_leadinteractions to leads_leadinteractions
-- This script identifies missing entries and inserts them

-- Step 1: Create a function to safely parse timestamps
CREATE OR REPLACE FUNCTION safe_parse_timestamp(ts_text TEXT)
RETURNS TIMESTAMPTZ AS $$
BEGIN
    IF ts_text IS NULL OR ts_text = '' THEN
        RETURN NULL;
    END IF;
    
    -- Try to parse various timestamp formats
    BEGIN
        RETURN ts_text::TIMESTAMPTZ;
    EXCEPTION WHEN OTHERS THEN
        BEGIN
            -- Try ISO format without timezone
            RETURN (ts_text || ' UTC')::TIMESTAMPTZ;
        EXCEPTION WHEN OTHERS THEN
            BEGIN
                -- Try as date only
                RETURN (ts_text || ' 00:00:00 UTC')::TIMESTAMPTZ;
            EXCEPTION WHEN OTHERS THEN
                RETURN NULL;
            END;
        END;
    END;
END;
$$ LANGUAGE plpgsql;

-- Step 2: Get the maximum ID from the target table to start numbering from
DO $$
DECLARE
    max_id bigint;
BEGIN
    SELECT COALESCE(MAX(id), 0) INTO max_id FROM leads_leadinteractions;
    RAISE NOTICE 'Maximum existing ID: %, starting new IDs from: %', max_id, max_id + 1;
END $$;

-- Step 3: Identify and insert missing entries with generated IDs
-- We compare based on lead_id and a combination of fields that make an interaction unique
WITH max_id_cte AS (
    SELECT COALESCE(MAX(id), 0) as max_id FROM leads_leadinteractions
),
src_interactions AS (
    SELECT 
        s.id as src_id,
        s.lead_id::bigint as lead_id,
        s.kind,
        s.date,
        s.time,
        s.content,
        s.cdate,
        s.udate,
        s.minutes,
        s.creator_id,
        s.direction,
        s.link,
        s.read,
        s.wa_num_id,
        s.employee_id,
        s.description,
        -- Create a unique fingerprint for comparison (normalized with LOWER and TRIM)
        -- Note: We compare kind, date, time, and content (excluding cdate as it may have format differences)
        LOWER(TRIM(COALESCE(s.kind, ''))) || '|' || 
        LOWER(TRIM(COALESCE(s.date, ''))) || '|' || 
        LOWER(TRIM(COALESCE(s.time, ''))) || '|' || 
        LOWER(TRIM(COALESCE(s.content, ''))) as interaction_fingerprint
    FROM src_leads_leadinteractions s
    WHERE s.lead_id IS NOT NULL 
        AND s.lead_id ~ '^[0-9]+$'  -- Only numeric lead_ids
        -- Note: We don't filter by existing lead_ids in target, as we want to copy ALL missing interactions
),
target_interactions AS (
    SELECT 
        t.lead_id,
        -- Create matching fingerprint (same logic as src)
        LOWER(TRIM(COALESCE(t.kind, ''))) || '|' || 
        LOWER(TRIM(COALESCE(t.date, ''))) || '|' || 
        LOWER(TRIM(COALESCE(t.time, ''))) || '|' || 
        LOWER(TRIM(COALESCE(t.content, ''))) as interaction_fingerprint
    FROM leads_leadinteractions t
    WHERE t.lead_id IS NOT NULL
),
missing_interactions AS (
    SELECT 
        s.*,
        ROW_NUMBER() OVER (ORDER BY s.lead_id, s.cdate) as row_num
    FROM src_interactions s
    LEFT JOIN target_interactions t ON 
        s.lead_id = t.lead_id 
        AND s.interaction_fingerprint = t.interaction_fingerprint
    WHERE t.lead_id IS NULL
)
INSERT INTO leads_leadinteractions (
    id,
    cdate,
    udate,
    kind,
    date,
    time,
    minutes,
    content,
    creator_id,
    lead_id,
    direction,
    link,
    read,
    wa_num_id,
    employee_id,
    description
)
SELECT 
    (SELECT max_id FROM max_id_cte) + mi.row_num as id,
    safe_parse_timestamp(mi.cdate) as cdate,
    safe_parse_timestamp(mi.udate) as udate,
    NULLIF(mi.kind, '') as kind,
    NULLIF(mi.date, '') as date,
    NULLIF(mi.time, '') as time,
    CASE 
        WHEN mi.minutes IS NULL OR mi.minutes = '' THEN NULL
        ELSE NULLIF(mi.minutes, '')::bigint
    END as minutes,
    NULLIF(mi.content, '') as content,
    CASE 
        WHEN mi.creator_id IS NULL OR mi.creator_id = '' THEN NULL
        ELSE mi.creator_id::bigint
    END as creator_id,
    mi.lead_id,
    NULLIF(mi.direction, '') as direction,
    NULLIF(mi.link, '') as link,
    NULLIF(mi.read, '') as read,
    NULLIF(mi.wa_num_id, '') as wa_num_id,
    CASE 
        WHEN mi.employee_id IS NULL OR mi.employee_id = '' THEN NULL
        ELSE mi.employee_id::bigint
    END as employee_id,
    NULLIF(mi.description, '') as description
FROM missing_interactions mi
ORDER BY mi.lead_id, mi.cdate;

-- Step 4: Update the sequence to match the new max ID
SELECT setval(
    'leads_leadinteractions_id_seq', 
    (SELECT COALESCE(MAX(id), 1) FROM leads_leadinteractions),
    true
);

-- Step 5: Report results (run this separately after the INSERT to verify)
SELECT 
    COUNT(*) as total_missing_before_insert,
    COUNT(DISTINCT lead_id) as unique_leads_with_missing
FROM (
    WITH src_interactions AS (
        SELECT 
            s.lead_id::bigint as lead_id,
            LOWER(TRIM(COALESCE(s.kind, ''))) || '|' || 
            LOWER(TRIM(COALESCE(s.date, ''))) || '|' || 
            LOWER(TRIM(COALESCE(s.time, ''))) || '|' || 
            LOWER(TRIM(COALESCE(s.content, ''))) || '|' || 
            LOWER(TRIM(COALESCE(s.cdate, ''))) as interaction_fingerprint
        FROM src_leads_leadinteractions s
        WHERE s.lead_id IS NOT NULL 
            AND s.lead_id ~ '^[0-9]+$'
    ),
    target_interactions AS (
        SELECT 
            t.lead_id,
            LOWER(TRIM(COALESCE(t.kind, ''))) || '|' || 
            LOWER(TRIM(COALESCE(t.date, ''))) || '|' || 
            LOWER(TRIM(COALESCE(t.time, ''))) || '|' || 
            LOWER(TRIM(COALESCE(t.content, ''))) as interaction_fingerprint
        FROM leads_leadinteractions t
        WHERE t.lead_id IS NOT NULL
    )
    SELECT s.lead_id
    FROM src_interactions s
    LEFT JOIN target_interactions t ON 
        s.lead_id = t.lead_id 
        AND s.interaction_fingerprint = t.interaction_fingerprint
    WHERE t.lead_id IS NULL
) missing;

-- Cleanup: Drop the helper function (optional, you can keep it if needed)
-- DROP FUNCTION IF EXISTS safe_parse_timestamp(TEXT);

