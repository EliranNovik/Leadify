-- =============================================
-- FIX: Leads Query Data Type Issues
-- =============================================
-- The expert_id and meeting_manager_id columns are TEXT, not INTEGER

-- Check the data types of the columns
SELECT 
  column_name, 
  data_type, 
  is_nullable
FROM information_schema.columns 
WHERE table_name = 'leads_lead' 
  AND column_name IN ('expert_id', 'meeting_manager_id', 'next_followup', 'status', 'stage')
ORDER BY column_name;

-- Test the corrected query with proper data type casting
SELECT COUNT(*) as test_count
FROM public.leads_lead 
WHERE next_followup <= '2025-09-30' 
  AND next_followup >= '2025-08-11' 
  AND next_followup IS NOT NULL 
  AND status = 0 
  AND stage < 100 
  AND (expert_id = '75' OR meeting_manager_id = '75');

-- Alternative: Cast to integer if the values are numeric strings
SELECT COUNT(*) as test_count_cast
FROM public.leads_lead 
WHERE next_followup <= '2025-09-30' 
  AND next_followup >= '2025-08-11' 
  AND next_followup IS NOT NULL 
  AND status = 0 
  AND stage < 100 
  AND (expert_id::integer = 75 OR meeting_manager_id::integer = 75);

-- Check what values are actually in these columns
SELECT 
  expert_id, 
  meeting_manager_id,
  COUNT(*) as count
FROM public.leads_lead 
WHERE expert_id IS NOT NULL OR meeting_manager_id IS NOT NULL
GROUP BY expert_id, meeting_manager_id
ORDER BY count DESC
LIMIT 10;
