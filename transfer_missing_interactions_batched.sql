-- ============================================================================
-- BATCHED TRANSFER: Transfer missing interactions in batches to avoid timeouts
-- ============================================================================
-- This script processes interactions in batches of 1000 rows at a time
-- Run each batch separately, or use a DO block to process all batches

-- STEP 1: Set sequence to start after highest existing ID (run this FIRST)
-- ============================================================================

SELECT setval('leads_leadinteractions_id_seq', 
    (SELECT COALESCE(MAX(id), 0) + 1 FROM leads_leadinteractions), 
    false
);

-- ============================================================================
-- STEP 2: Note about duplicate prevention
-- ============================================================================
-- The WHERE clause already prevents duplicates by checking if the interaction
-- already exists in leads_leadinteractions based on lead_id, date, time, and content
-- No need for a separate tracking table

-- ============================================================================
-- STEP 3: Batch Transfer Function
-- ============================================================================
-- This function processes one batch at a time
-- Adjust BATCH_SIZE as needed (1000 is a safe default, increase if your DB can handle it)

DO $$
DECLARE
    BATCH_SIZE integer := 1000;
    rows_inserted integer;
    total_processed integer := 0;
    batch_number integer := 1;
BEGIN
    LOOP
        -- Insert one batch
        WITH batch_to_insert AS (
            SELECT 
                src.id as src_id,
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
                )
            LIMIT BATCH_SIZE
        )
        INSERT INTO leads_leadinteractions (
            cdate, udate, kind, date, time, minutes, content, creator_id, 
            lead_id, direction, link, read, wa_num_id, employee_id, description, contact_id
        )
        SELECT 
            cdate, udate, kind, date, time, minutes, content, creator_id,
            lead_id, direction, link, read, wa_num_id, employee_id, description, contact_id
        FROM batch_to_insert;
        
        GET DIAGNOSTICS rows_inserted = ROW_COUNT;
        
        total_processed := total_processed + rows_inserted;
        
        RAISE NOTICE 'Batch %: Inserted % rows. Total processed: %', batch_number, rows_inserted, total_processed;
        
        -- Exit if no more rows to process
        EXIT WHEN rows_inserted = 0;
        
        batch_number := batch_number + 1;
        
        -- Optional: Add a small delay to avoid overwhelming the database
        -- PERFORM pg_sleep(0.1);  -- 100ms delay between batches
        
    END LOOP;
    
    RAISE NOTICE 'Transfer complete! Total rows processed: %', total_processed;
END $$;

-- ============================================================================
-- ALTERNATIVE: Manual Batch Processing (if DO block doesn't work)
-- ============================================================================
-- If the DO block times out or doesn't work, use these queries manually
-- Run each batch separately, increasing OFFSET each time

-- Batch 1 (rows 1-1000)
/*
INSERT INTO leads_leadinteractions (
    cdate, udate, kind, date, time, minutes, content, creator_id, 
    lead_id, direction, link, read, wa_num_id, employee_id, description, contact_id
)
SELECT 
    CASE 
        WHEN src.cdate IS NULL OR src.cdate = '' THEN NULL
        WHEN src.cdate ~ '^\d{4}-\d{2}-\d{2}' THEN 
            CASE 
                WHEN src.cdate ~ '^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}' THEN CAST(src.cdate AS timestamp with time zone)
                WHEN src.cdate ~ '^\d{4}-\d{2}-\d{2}' THEN CAST(src.cdate AS date)::timestamp with time zone
                ELSE NULL
            END
        ELSE NULL
    END as cdate,
    CASE 
        WHEN src.udate IS NULL OR src.udate = '' THEN NULL
        WHEN src.udate ~ '^\d{4}-\d{2}-\d{2}' THEN 
            CASE 
                WHEN src.udate ~ '^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}' THEN CAST(src.udate AS timestamp with time zone)
                WHEN src.udate ~ '^\d{4}-\d{2}-\d{2}' THEN CAST(src.udate AS date)::timestamp with time zone
                ELSE NULL
            END
        ELSE NULL
    END as udate,
    src.kind, src.date, src.time,
    CASE WHEN src.minutes IS NULL OR src.minutes = '' THEN NULL
         WHEN src.minutes ~ '^\d+$' THEN CAST(src.minutes AS bigint) ELSE NULL END as minutes,
    src.content, src.creator_id, CAST(src.lead_id AS bigint) as lead_id,
    src.direction, src.link, src.read, src.wa_num_id, src.employee_id, src.description,
    (SELECT llc.id FROM lead_leadcontact llc 
     WHERE llc.lead_id = CAST(src.lead_id AS bigint)
     ORDER BY CASE WHEN llc.main = 'true' THEN 1 ELSE 2 END, llc.id LIMIT 1) as contact_id
FROM src_leads_leadinteractions src
WHERE src.lead_id IS NOT NULL
  AND src.lead_id ~ '^[0-9]+$'
  AND EXISTS (SELECT 1 FROM leads_lead ll WHERE ll.id = CAST(src.lead_id AS bigint))
  AND NOT EXISTS (
      SELECT 1 FROM leads_leadinteractions ll 
      WHERE ll.lead_id = CAST(src.lead_id AS bigint)
        AND (src.date IS NULL OR ll.date = src.date)
        AND (src.time IS NULL OR ll.time = src.time)
        AND (src.content IS NULL OR LEFT(ll.content, 100) = LEFT(src.content, 100))
  )
ORDER BY src.id
LIMIT 1000;
*/

-- ============================================================================
-- STEP 4: Check progress
-- ============================================================================
-- Run this to see how many rows remain to be processed

SELECT 
    (SELECT COUNT(*) FROM leads_leadinteractions) as total_in_target_table,
    (SELECT COUNT(*) FROM src_leads_leadinteractions 
     WHERE lead_id IS NOT NULL AND lead_id ~ '^[0-9]+$'
     AND EXISTS (SELECT 1 FROM leads_lead ll WHERE ll.id = CAST(lead_id AS bigint))
     AND NOT EXISTS (
         SELECT 1 FROM leads_leadinteractions ll 
         WHERE ll.lead_id = CAST(src_leads_leadinteractions.lead_id AS bigint)
           AND (src_leads_leadinteractions.date IS NULL OR ll.date = src_leads_leadinteractions.date)
           AND (src_leads_leadinteractions.time IS NULL OR ll.time = src_leads_leadinteractions.time)
           AND (src_leads_leadinteractions.content IS NULL OR LEFT(ll.content, 100) = LEFT(src_leads_leadinteractions.content, 100))
     )) as remaining_to_process;

-- ============================================================================
-- STEP 5: Verify final count
-- ============================================================================

SELECT 
    COUNT(*) as still_missing_interactions_count
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
