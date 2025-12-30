-- Validate that all columns referenced in migration exist in leads_lead_src
-- This query will show columns that DON'T exist in leads_lead_src

-- Check which columns exist in leads_lead_src
SELECT column_name, data_type 
FROM information_schema.columns 
WHERE table_name = 'leads_lead_src' 
  AND table_schema = 'public'
ORDER BY ordinal_position;

-- Check which columns exist in leads_lead  
SELECT column_name, data_type 
FROM information_schema.columns 
WHERE table_name = 'leads_lead' 
  AND table_schema = 'public'
ORDER BY ordinal_position;

