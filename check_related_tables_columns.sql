-- Quick query to find the correct column names in related tables
-- This will help us identify which column references leads_lead

-- Check follow_ups table
SELECT 'follow_ups' as table_name, 
       column_name, 
       data_type
FROM information_schema.columns
WHERE table_name = 'follow_ups' 
  AND column_name LIKE '%lead%'
ORDER BY column_name;

-- Check leads_lead_tags table
SELECT 'leads_lead_tags' as table_name, 
       column_name, 
       data_type
FROM information_schema.columns
WHERE table_name = 'leads_lead_tags' 
  AND column_name LIKE '%lead%'
ORDER BY column_name;

-- Check meetings table
SELECT 'meetings' as table_name, 
       column_name, 
       data_type
FROM information_schema.columns
WHERE table_name = 'meetings' 
  AND column_name LIKE '%lead%'
ORDER BY column_name;

-- Check proformas table
SELECT 'proformas' as table_name, 
       column_name, 
       data_type
FROM information_schema.columns
WHERE table_name = 'proformas' 
  AND column_name LIKE '%lead%'
ORDER BY column_name;

-- Check whatsapp_messages table
SELECT 'whatsapp_messages' as table_name, 
       column_name, 
       data_type
FROM information_schema.columns
WHERE table_name = 'whatsapp_messages' 
  AND column_name LIKE '%lead%'
ORDER BY column_name;

-- Check emails table
SELECT 'emails' as table_name, 
       column_name, 
       data_type
FROM information_schema.columns
WHERE table_name = 'emails' 
  AND column_name LIKE '%lead%'
ORDER BY column_name;

-- Check proformainvoice table
SELECT 'proformainvoice' as table_name, 
       column_name, 
       data_type
FROM information_schema.columns
WHERE table_name = 'proformainvoice' 
  AND column_name LIKE '%lead%'
ORDER BY column_name;

