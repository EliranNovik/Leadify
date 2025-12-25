-- SAFE VERSION: Delete duplicate emails with preview and transaction
-- This version shows what will be deleted before actually deleting

BEGIN;

-- STEP 1: Preview duplicates that will be deleted based on (message_id, client_id)
SELECT 
    'Duplicates by (message_id, client_id)' as duplicate_type,
    COUNT(*) as rows_to_delete
FROM (
    SELECT 
        id,
        ROW_NUMBER() OVER (
            PARTITION BY message_id, client_id 
            ORDER BY 
                CASE WHEN contact_id IS NOT NULL THEN 0 ELSE 1 END,
                id ASC
        ) as rn
    FROM public.emails
    WHERE message_id IS NOT NULL AND client_id IS NOT NULL
) sub
WHERE rn > 1;

-- STEP 2: Preview duplicates that will be deleted based on (message_id, legacy_id)
SELECT 
    'Duplicates by (message_id, legacy_id)' as duplicate_type,
    COUNT(*) as rows_to_delete
FROM (
    SELECT 
        id,
        ROW_NUMBER() OVER (
            PARTITION BY message_id, legacy_id 
            ORDER BY 
                CASE WHEN contact_id IS NOT NULL THEN 0 ELSE 1 END,
                id ASC
        ) as rn
    FROM public.emails
    WHERE message_id IS NOT NULL AND legacy_id IS NOT NULL
) sub
WHERE rn > 1;

-- STEP 3: Preview duplicates that will be deleted based on (message_id, contact_id)
SELECT 
    'Duplicates by (message_id, contact_id)' as duplicate_type,
    COUNT(*) as rows_to_delete
FROM (
    SELECT 
        id,
        ROW_NUMBER() OVER (
            PARTITION BY message_id, contact_id 
            ORDER BY id ASC
        ) as rn
    FROM public.emails
    WHERE message_id IS NOT NULL AND contact_id IS NOT NULL
) sub
WHERE rn > 1;

-- STEP 4: Show sample of rows that will be deleted (first 20)
SELECT 
    e.id,
    e.message_id,
    e.client_id,
    e.legacy_id,
    e.contact_id,
    e.sender_email,
    e.subject,
    e.sent_at,
    'Will be deleted' as action
FROM public.emails e
WHERE e.id IN (
    -- Duplicates by client_id
    SELECT id FROM (
        SELECT 
            id,
            ROW_NUMBER() OVER (
                PARTITION BY message_id, client_id 
                ORDER BY 
                    CASE WHEN contact_id IS NOT NULL THEN 0 ELSE 1 END,
                    id ASC
            ) as rn
        FROM public.emails
        WHERE message_id IS NOT NULL AND client_id IS NOT NULL
    ) sub WHERE rn > 1
    
    UNION
    
    -- Duplicates by legacy_id
    SELECT id FROM (
        SELECT 
            id,
            ROW_NUMBER() OVER (
                PARTITION BY message_id, legacy_id 
                ORDER BY 
                    CASE WHEN contact_id IS NOT NULL THEN 0 ELSE 1 END,
                    id ASC
            ) as rn
        FROM public.emails
        WHERE message_id IS NOT NULL AND legacy_id IS NOT NULL
    ) sub WHERE rn > 1
    
    UNION
    
    -- Duplicates by contact_id
    SELECT id FROM (
        SELECT 
            id,
            ROW_NUMBER() OVER (
                PARTITION BY message_id, contact_id 
                ORDER BY id ASC
            ) as rn
        FROM public.emails
        WHERE message_id IS NOT NULL AND contact_id IS NOT NULL
    ) sub WHERE rn > 1
)
ORDER BY e.message_id, e.id
LIMIT 20;

-- STEP 5: If the preview looks correct, uncomment the DELETE statements below and run again
-- Otherwise, run ROLLBACK; to cancel

/*
-- Delete duplicates based on (message_id, client_id)
WITH duplicates_client AS (
    SELECT 
        id,
        ROW_NUMBER() OVER (
            PARTITION BY message_id, client_id 
            ORDER BY 
                CASE WHEN contact_id IS NOT NULL THEN 0 ELSE 1 END,
                id ASC
        ) as rn
    FROM public.emails
    WHERE message_id IS NOT NULL AND client_id IS NOT NULL
)
DELETE FROM public.emails
WHERE id IN (SELECT id FROM duplicates_client WHERE rn > 1);

-- Delete duplicates based on (message_id, legacy_id)
WITH duplicates_legacy AS (
    SELECT 
        id,
        ROW_NUMBER() OVER (
            PARTITION BY message_id, legacy_id 
            ORDER BY 
                CASE WHEN contact_id IS NOT NULL THEN 0 ELSE 1 END,
                id ASC
        ) as rn
    FROM public.emails
    WHERE message_id IS NOT NULL AND legacy_id IS NOT NULL
)
DELETE FROM public.emails
WHERE id IN (SELECT id FROM duplicates_legacy WHERE rn > 1);

-- Delete duplicates based on (message_id, contact_id)
WITH duplicates_contact AS (
    SELECT 
        id,
        ROW_NUMBER() OVER (
            PARTITION BY message_id, contact_id 
            ORDER BY id ASC
        ) as rn
    FROM public.emails
    WHERE message_id IS NOT NULL AND contact_id IS NOT NULL
)
DELETE FROM public.emails
WHERE id IN (SELECT id FROM duplicates_contact WHERE rn > 1);
*/

-- If you ran the DELETE statements above, uncomment the COMMIT below
-- Otherwise, run ROLLBACK; to cancel
-- COMMIT;

-- To cancel: ROLLBACK;

