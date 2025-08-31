-- Clean up duplicate WhatsApp messages
-- This script removes duplicate records where the same message was saved multiple times

-- First, let's see what duplicates we have
SELECT 
  message,
  sent_at,
  COUNT(*) as duplicate_count
FROM whatsapp_messages 
WHERE message IS NOT NULL
GROUP BY message, sent_at
HAVING COUNT(*) > 1
ORDER BY sent_at DESC;

-- Remove duplicates, keeping only the first record for each message
DELETE FROM whatsapp_messages 
WHERE id IN (
  SELECT id FROM (
    SELECT id,
           ROW_NUMBER() OVER (
             PARTITION BY message, sent_at 
             ORDER BY id
           ) as rn
    FROM whatsapp_messages
    WHERE message IS NOT NULL
  ) t
  WHERE t.rn > 1
);

-- Verify cleanup
SELECT 
  message,
  sent_at,
  COUNT(*) as count_after_cleanup
FROM whatsapp_messages 
WHERE message IS NOT NULL
GROUP BY message, sent_at
HAVING COUNT(*) > 1
ORDER BY sent_at DESC;
