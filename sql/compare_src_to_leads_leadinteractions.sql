-- Step 1: Compare src_leads_leadinteractions with leads_leadinteractions
-- Find entries that are missing based on lead_id and key fields

-- First, let's see a sample of what we're working with
SELECT 
    COUNT(*) as total_src_entries,
    COUNT(DISTINCT lead_id) as unique_lead_ids_in_src
FROM src_leads_leadinteractions
WHERE lead_id IS NOT NULL AND lead_id ~ '^[0-9]+$';

SELECT 
    COUNT(*) as total_target_entries,
    COUNT(DISTINCT lead_id) as unique_lead_ids_in_target
FROM leads_leadinteractions
WHERE lead_id IS NOT NULL;

-- Step 2: Identify missing entries per lead_id
-- We'll compare based on lead_id, kind, date, time, and content (or cdate if content is null)
-- This creates a unique fingerprint for each interaction per lead

WITH src_interactions AS (
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
        -- Create a unique fingerprint for comparison
        -- Use COALESCE to handle NULLs, and trim to normalize whitespace
        -- Note: We compare kind, date, time, and content (excluding cdate as it may have format differences)
        LOWER(TRIM(COALESCE(s.kind, ''))) || '|' || 
        LOWER(TRIM(COALESCE(s.date, ''))) || '|' || 
        LOWER(TRIM(COALESCE(s.time, ''))) || '|' || 
        LOWER(TRIM(COALESCE(s.content, ''))) as interaction_fingerprint
    FROM src_leads_leadinteractions s
    WHERE s.lead_id IS NOT NULL 
        AND s.lead_id ~ '^[0-9]+$'  -- Only numeric lead_ids
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
)
SELECT 
    s.lead_id,
    COUNT(*) as missing_count
FROM src_interactions s
LEFT JOIN target_interactions t ON 
    s.lead_id = t.lead_id 
    AND s.interaction_fingerprint = t.interaction_fingerprint
WHERE t.lead_id IS NULL
GROUP BY s.lead_id
ORDER BY s.lead_id;

-- Step 3: Show detailed missing entries for a sample lead_id
WITH src_interactions AS (
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
        LOWER(TRIM(COALESCE(s.kind, ''))) || '|' || 
        LOWER(TRIM(COALESCE(s.date, ''))) || '|' || 
        LOWER(TRIM(COALESCE(s.time, ''))) || '|' || 
        LOWER(TRIM(COALESCE(s.content, ''))) as interaction_fingerprint
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
SELECT 
    s.*,
    'MISSING' as status
FROM src_interactions s
LEFT JOIN target_interactions t ON 
    s.lead_id = t.lead_id 
    AND s.interaction_fingerprint = t.interaction_fingerprint
WHERE t.lead_id IS NULL
ORDER BY s.lead_id, s.cdate;

