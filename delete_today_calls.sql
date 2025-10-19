-- Delete call logs from today (2025-10-06)
-- WARNING: This will permanently delete all call logs from today

-- Option 1: Delete by date column (if it exists)
DELETE FROM call_logs 
WHERE date = '2025-10-06';

-- Option 2: Delete by cdate column (creation date) - more reliable
DELETE FROM call_logs 
WHERE DATE(cdate) = '2025-10-06';

-- Option 3: Delete by cdate with timezone consideration (most comprehensive)
DELETE FROM call_logs 
WHERE cdate >= '2025-10-06 00:00:00+00' 
  AND cdate < '2025-10-07 00:00:00+00';

-- Check how many records will be deleted first (recommended)
-- Uncomment the line below to see the count before deleting:
-- SELECT COUNT(*) FROM call_logs WHERE DATE(cdate) = '2025-10-06';
