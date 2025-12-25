-- Delete duplicate emails from the emails table
-- This script keeps one row per unique (message_id, client_id), (message_id, legacy_id), or (message_id, contact_id)
-- Priority: If multiple rows exist for the same lead, keep the one with contact_id

-- STEP 1: Preview what will be deleted (run this first to see what duplicates exist)
-- Uncomment the SELECT below to preview before deleting

/*
SELECT 
    message_id,
    client_id,
    legacy_id,
    contact_id,
    sender_email,
    subject,
    sent_at,
    COUNT(*) as duplicate_count
FROM public.emails
WHERE message_id IS NOT NULL
GROUP BY message_id, client_id, legacy_id, contact_id, sender_email, subject, sent_at
HAVING COUNT(*) > 1
ORDER BY duplicate_count DESC, message_id
LIMIT 100;
*/

-- STEP 2: Delete duplicates based on (message_id, client_id)
-- Keeps the row with contact_id if available, otherwise keeps the oldest row (by id)
WITH duplicates_client AS (
    SELECT 
        id,
        message_id,
        client_id,
        contact_id,
        ROW_NUMBER() OVER (
            PARTITION BY message_id, client_id 
            ORDER BY 
                CASE WHEN contact_id IS NOT NULL THEN 0 ELSE 1 END, -- Prefer rows with contact_id
                id ASC -- If no contact_id, keep the oldest (lowest id)
        ) as rn
    FROM public.emails
    WHERE message_id IS NOT NULL 
      AND client_id IS NOT NULL
)
DELETE FROM public.emails
WHERE id IN (
    SELECT id FROM duplicates_client WHERE rn > 1
);

-- STEP 3: Delete duplicates based on (message_id, legacy_id)
-- Keeps the row with contact_id if available, otherwise keeps the oldest row (by id)
WITH duplicates_legacy AS (
    SELECT 
        id,
        message_id,
        legacy_id,
        contact_id,
        ROW_NUMBER() OVER (
            PARTITION BY message_id, legacy_id 
            ORDER BY 
                CASE WHEN contact_id IS NOT NULL THEN 0 ELSE 1 END, -- Prefer rows with contact_id
                id ASC -- If no contact_id, keep the oldest (lowest id)
        ) as rn
    FROM public.emails
    WHERE message_id IS NOT NULL 
      AND legacy_id IS NOT NULL
)
DELETE FROM public.emails
WHERE id IN (
    SELECT id FROM duplicates_legacy WHERE rn > 1
);

-- STEP 4: Delete duplicates based on (message_id, contact_id)
-- Keeps the oldest row (by id) for each (message_id, contact_id) combination
WITH duplicates_contact AS (
    SELECT 
        id,
        message_id,
        contact_id,
        ROW_NUMBER() OVER (
            PARTITION BY message_id, contact_id 
            ORDER BY id ASC -- Keep the oldest (lowest id)
        ) as rn
    FROM public.emails
    WHERE message_id IS NOT NULL 
      AND contact_id IS NOT NULL
)
DELETE FROM public.emails
WHERE id IN (
    SELECT id FROM duplicates_contact WHERE rn > 1
);

-- STEP 5: Verify deletion results
-- Run this after the deletions to see how many unique rows remain
SELECT 
    'Total emails' as metric,
    COUNT(*) as count
FROM public.emails
WHERE message_id IS NOT NULL

UNION ALL

SELECT 
    'Unique (message_id, client_id)' as metric,
    COUNT(DISTINCT (message_id, client_id)) as count
FROM public.emails
WHERE message_id IS NOT NULL AND client_id IS NOT NULL

UNION ALL

SELECT 
    'Unique (message_id, legacy_id)' as metric,
    COUNT(DISTINCT (message_id, legacy_id)) as count
FROM public.emails
WHERE message_id IS NOT NULL AND legacy_id IS NOT NULL

UNION ALL

SELECT 
    'Unique (message_id, contact_id)' as metric,
    COUNT(DISTINCT (message_id, contact_id)) as count
FROM public.emails
WHERE message_id IS NOT NULL AND contact_id IS NOT NULL;

-- STEP 6: Check for any remaining exact duplicates (same message_id + client_id + legacy_id + contact_id)
-- This should return 0 rows after running the deletions above
SELECT 
    message_id,
    client_id,
    legacy_id,
    contact_id,
    COUNT(*) as duplicate_count
FROM public.emails
WHERE message_id IS NOT NULL
GROUP BY message_id, client_id, legacy_id, contact_id
HAVING COUNT(*) > 1
ORDER BY duplicate_count DESC;

