-- ============================================================================
-- SIMPLE BATCHED TRANSFER: Run each batch separately
-- ============================================================================
-- Process 1000-5000 rows at a time to avoid timeouts
-- Run STEP 1 first, then run STEP 2 multiple times until no more rows are inserted

-- ============================================================================
-- STEP 1: Set sequence to start after highest existing ID (run this FIRST, once)
-- ============================================================================

SELECT setval('leads_leadinteractions_id_seq', 
    (SELECT COALESCE(MAX(id), 0) + 1 FROM leads_leadinteractions), 
    false
);

-- ============================================================================
-- STEP 2: Insert one batch (run this multiple times until it returns 0 rows)
-- ============================================================================
-- Adjust LIMIT value (1000-5000) based on your database performance
-- Run this query repeatedly until it inserts 0 rows

WITH batch_to_insert AS (
    SELECT 
        -- Convert cdate from text to timestamp
        CASE 
            WHEN src.cdate IS NULL OR src.cdate = '' THEN NULL
            WHEN src.cdate ~ '^\d{4}-\d{2}-\d{2}' THEN 
                CASE 
                    WHEN src.cdate ~ '^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}' THEN 
                        CAST(src.cdate AS timestamp with time zone)
                    WHEN src.cdate ~ '^\d{4}-\d{2}-\d{2}' THEN 
                        CAST(src.cdate AS date)::timestamp with time zone
                    ELSE NULL
                END
            ELSE NULL
        END as cdate,
        
        -- Convert udate from text to timestamp
        CASE 
            WHEN src.udate IS NULL OR src.udate = '' THEN NULL
            WHEN src.udate ~ '^\d{4}-\d{2}-\d{2}' THEN 
                CASE 
                    WHEN src.udate ~ '^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}' THEN 
                        CAST(src.udate AS timestamp with time zone)
                    WHEN src.udate ~ '^\d{4}-\d{2}-\d{2}' THEN 
                        CAST(src.udate AS date)::timestamp with time zone
                    ELSE NULL
                END
            ELSE NULL
        END as udate,
        
        src.kind,
        src.date,
        src.time,
        
        -- Convert minutes from text to bigint
        CASE 
            WHEN src.minutes IS NULL OR src.minutes = '' THEN NULL
            WHEN src.minutes ~ '^\d+$' THEN CAST(src.minutes AS bigint)
            ELSE NULL
        END as minutes,
        
        src.content,
        src.creator_id,
        
        -- Convert lead_id from text to bigint
        CAST(src.lead_id AS bigint) as lead_id,
        
        src.direction,
        src.link,
        src.read,
        src.wa_num_id,
        src.employee_id,
        src.description,
        
        -- Try to find contact_id from lead_leadcontact based on lead_id
        (
            SELECT llc.id
            FROM lead_leadcontact llc
            WHERE llc.lead_id = CAST(src.lead_id AS bigint)
            ORDER BY 
                CASE WHEN llc.main = 'true' THEN 1 ELSE 2 END,
                llc.id
            LIMIT 1
        ) as contact_id
        
    FROM 
        src_leads_leadinteractions src
    WHERE 
        src.lead_id IS NOT NULL
        AND src.lead_id ~ '^[0-9]+$'  -- Only numeric lead_ids
        -- Validate foreign keys
        AND EXISTS (
            SELECT 1 
            FROM leads_lead ll 
            WHERE ll.id = CAST(src.lead_id AS bigint)
        )
        -- Avoid duplicates
        AND NOT EXISTS (
            SELECT 1 
            FROM leads_leadinteractions ll 
            WHERE 
                ll.lead_id = CAST(src.lead_id AS bigint)
                AND (src.date IS NULL OR ll.date = src.date)
                AND (src.time IS NULL OR ll.time = src.time)
                AND (src.content IS NULL OR LEFT(ll.content, 100) = LEFT(src.content, 100))
        )
    ORDER BY src.id  -- Consistent ordering for batching
    LIMIT 2000  -- Adjust this number: 1000-5000 based on performance
)
INSERT INTO leads_leadinteractions (
    cdate, udate, kind, date, time, minutes, content, creator_id, 
    lead_id, direction, link, read, wa_num_id, employee_id, description, contact_id
)
SELECT 
    cdate, udate, kind, date, time, minutes, content, creator_id,
    lead_id, direction, link, read, wa_num_id, employee_id, description, contact_id
FROM batch_to_insert;

-- ============================================================================
-- STEP 3: Check remaining count (run after each batch)
-- ============================================================================
-- This shows how many interactions are still remaining

SELECT 
    COUNT(*) as remaining_interactions_count
FROM 
    src_leads_leadinteractions src
WHERE 
    src.lead_id IS NOT NULL
    AND src.lead_id ~ '^[0-9]+$'
    AND EXISTS (
        SELECT 1 
        FROM leads_lead ll 
        WHERE ll.id = CAST(src.lead_id AS bigint)
    )
    AND NOT EXISTS (
        SELECT 1 
        FROM leads_leadinteractions ll 
        WHERE 
            ll.lead_id = CAST(src.lead_id AS bigint)
            AND (src.date IS NULL OR ll.date = src.date)
            AND (src.time IS NULL OR ll.time = src.time)
            AND (src.content IS NULL OR LEFT(ll.content, 100) = LEFT(src.content, 100))
    );

-- ============================================================================
-- STEP 4: Progress tracking query
-- ============================================================================
-- Run this to see overall progress

SELECT 
    (SELECT COUNT(*) FROM leads_leadinteractions) as total_in_target_table,
    (SELECT COUNT(*) FROM src_leads_leadinteractions 
     WHERE lead_id IS NOT NULL 
     AND lead_id ~ '^[0-9]+$'
     AND EXISTS (SELECT 1 FROM leads_lead ll WHERE ll.id = CAST(lead_id AS bigint))
     AND NOT EXISTS (
         SELECT 1 FROM leads_leadinteractions ll 
         WHERE ll.lead_id = CAST(src_leads_leadinteractions.lead_id AS bigint)
           AND (src_leads_leadinteractions.date IS NULL OR ll.date = src_leads_leadinteractions.date)
           AND (src_leads_leadinteractions.time IS NULL OR ll.time = src_leads_leadinteractions.time)
           AND (src_leads_leadinteractions.content IS NULL OR LEFT(ll.content, 100) = LEFT(src_leads_leadinteractions.content, 100))
     )) as remaining_to_transfer;
