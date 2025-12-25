-- Allow multiple email rows with the same message_id
-- This enables emails to appear in all leads where the email address matches
-- Each row can have different client_id, legacy_id, or contact_id combinations

-- 1. Drop the existing unique constraint on message_id
ALTER TABLE public.emails 
DROP CONSTRAINT IF EXISTS emails_message_id_key;

-- 2. Create unique indexes to ensure one row per message_id per client_id, legacy_id, or contact_id
-- This prevents duplicates where the same message_id is saved multiple times for the same lead/contact

-- One row per (message_id, client_id) combination
CREATE UNIQUE INDEX IF NOT EXISTS emails_message_id_client_id_unique 
ON public.emails (message_id, client_id)
WHERE message_id IS NOT NULL AND client_id IS NOT NULL;

-- One row per (message_id, legacy_id) combination
CREATE UNIQUE INDEX IF NOT EXISTS emails_message_id_legacy_id_unique 
ON public.emails (message_id, legacy_id)
WHERE message_id IS NOT NULL AND legacy_id IS NOT NULL;

-- One row per (message_id, contact_id) combination
CREATE UNIQUE INDEX IF NOT EXISTS emails_message_id_contact_id_unique 
ON public.emails (message_id, contact_id)
WHERE message_id IS NOT NULL AND contact_id IS NOT NULL;

-- Also create a composite unique index to prevent exact duplicates
-- (same message_id + same client_id + same legacy_id + same contact_id)
CREATE UNIQUE INDEX IF NOT EXISTS emails_message_id_client_legacy_contact_unique 
ON public.emails (message_id, client_id, legacy_id, contact_id)
WHERE message_id IS NOT NULL;

-- 3. Verify the constraint was dropped
SELECT 
    conname AS constraint_name,
    contype AS constraint_type
FROM pg_constraint
WHERE conrelid = 'public.emails'::regclass
AND conname LIKE '%message_id%';

-- 4. Verify the new index was created
SELECT 
    indexname,
    indexdef
FROM pg_indexes
WHERE tablename = 'emails'
AND indexname LIKE '%message_id%';

