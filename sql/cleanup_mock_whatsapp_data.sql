-- Clean up mock WhatsApp messages
-- This script removes any messages with mock media IDs that don't exist in the real WhatsApp API

-- Delete messages with mock media IDs
DELETE FROM whatsapp_messages 
WHERE media_url LIKE '%mock_%' 
   OR media_url LIKE '%test_%'
   OR whatsapp_message_id LIKE '%mock_%'
   OR whatsapp_message_id LIKE '%test_%';

-- Delete messages with invalid media URLs (empty or null)
DELETE FROM whatsapp_messages 
WHERE media_url = '' 
   OR media_url IS NULL;

-- Show remaining messages count
SELECT 
  COUNT(*) as total_messages,
  COUNT(CASE WHEN media_url IS NOT NULL THEN 1 END) as messages_with_media,
  COUNT(CASE WHEN media_url IS NULL THEN 1 END) as text_only_messages
FROM whatsapp_messages;

-- Show sample of remaining messages
SELECT 
  id,
  lead_id,
  sender_name,
  direction,
  message_type,
  media_url,
  created_at
FROM whatsapp_messages 
ORDER BY created_at DESC 
LIMIT 10; 