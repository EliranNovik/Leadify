-- Delete call logs from October 2025 to test the improved sync
-- This will remove all call logs with cdate in October 2025

DELETE FROM call_logs 
WHERE cdate >= '2025-10-01' 
  AND cdate < '2025-11-01';

-- Show how many records were deleted
SELECT 
  COUNT(*) as deleted_records,
  'October 2025 call logs deleted' as message;
