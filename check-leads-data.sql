-- Check what values exist in the closer_id and meeting_scheduler_id fields
SELECT 
  'closer_id' as field_name,
  closer_id as field_value,
  COUNT(*) as count
FROM leads_lead 
WHERE closer_id IS NOT NULL AND closer_id != ''
GROUP BY closer_id
ORDER BY count DESC
LIMIT 10;

SELECT 
  'meeting_scheduler_id' as field_name,
  meeting_scheduler_id as field_value,
  COUNT(*) as count
FROM leads_lead 
WHERE meeting_scheduler_id IS NOT NULL AND meeting_scheduler_id != ''
GROUP BY meeting_scheduler_id
ORDER BY count DESC
LIMIT 10;

-- Check a few sample leads to see the actual data
SELECT 
  id,
  name,
  closer_id,
  meeting_scheduler_id,
  expert_id,
  meeting_manager_id
FROM leads_lead 
LIMIT 5;
