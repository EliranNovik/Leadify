-- Fix date fields in call_logs table
-- 
-- This script fixes dates that were incorrectly stored due to UTC timezone conversion.
-- It extracts the date directly from the cdate field (which stores OneCom's original format)
-- without timezone conversion.
--
-- Usage:
--   1. Review the query results first to see what will be updated
--   2. Run the UPDATE statements to apply the fixes
--
-- Note: The cdate field stores dates in format: "YYYY-MM-DD HH:MM:SS" (local time)

-- Step 1: Review records that will be updated (run this first to see what will change)
SELECT 
    id,
    cdate,
    date AS current_date,
    time AS current_time,
    -- Extract date from cdate timestamp field
    DATE(cdate) AS new_date,
    -- Extract time from cdate timestamp field
    cdate::time AS new_time,
    onecom_uniqueid
FROM call_logs
WHERE cdate IS NOT NULL
    AND (
        -- Find records where date needs fixing
        date IS NULL 
        OR time IS NULL
        OR date != DATE(cdate)
        OR time != cdate::time
    )
ORDER BY id
LIMIT 100;  -- Preview first 100 records

-- Step 2: Count how many records will be updated
SELECT 
    COUNT(*) as total_records_to_update
FROM call_logs
WHERE cdate IS NOT NULL
    AND (
        date IS NULL 
        OR time IS NULL
        OR date != DATE(cdate)
        OR time != cdate::time
    );

-- Step 3: Update records using cdate field (Primary method)
-- Extract date and time directly from cdate timestamp field
UPDATE call_logs
SET 
    date = DATE(cdate),      -- Extract date part from timestamp
    time = cdate::time       -- Extract time part from timestamp
WHERE cdate IS NOT NULL
    AND (
        date IS NULL 
        OR time IS NULL
        OR date != DATE(cdate)
        OR time != cdate::time
    );

-- Step 4: Fix records that only have onecom_raw_data (Fallback method)
-- Extract date from onecom_raw_data JSONB field if cdate is not available
-- The start field in JSON is a string in format "YYYY-MM-DD HH:MM:SS"
UPDATE call_logs
SET 
    date = DATE((onecom_raw_data->>'start')::timestamp),           -- Extract date from JSON start field
    time = (onecom_raw_data->>'start')::timestamp::time            -- Extract time from JSON start field
WHERE cdate IS NULL
    AND onecom_raw_data IS NOT NULL
    AND onecom_raw_data ? 'start'
    AND onecom_raw_data->>'start' ~ '^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}'  -- Validate format
    AND (
        date IS NULL 
        OR time IS NULL
        OR date != DATE((onecom_raw_data->>'start')::timestamp)
        OR time != (onecom_raw_data->>'start')::timestamp::time
    );

-- Step 5: Verify the results
SELECT 
    COUNT(*) as total_records,
    COUNT(CASE WHEN date IS NOT NULL AND time IS NOT NULL THEN 1 END) as records_with_date_time,
    COUNT(CASE WHEN date IS NULL OR time IS NULL THEN 1 END) as records_missing_date_time
FROM call_logs
WHERE cdate IS NOT NULL OR onecom_raw_data IS NOT NULL;

-- Step 6: Show sample of fixed records
SELECT 
    id,
    cdate,
    date,
    time,
    onecom_uniqueid
FROM call_logs
WHERE date IS NOT NULL 
    AND time IS NOT NULL
    AND (cdate IS NOT NULL OR onecom_raw_data IS NOT NULL)
ORDER BY id DESC
LIMIT 20;

