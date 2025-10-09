-- Fix onecom_te_id column type to handle large numbers from 1com API
-- The 1com API returns very large call IDs that exceed PostgreSQL integer limit

-- Change onecom_te_id from INTEGER to TEXT to handle large numbers
ALTER TABLE call_logs 
ALTER COLUMN onecom_te_id TYPE TEXT;

-- Update the comment to reflect the change
COMMENT ON COLUMN call_logs.onecom_te_id IS 'Tenant extension ID from 1com API (stored as text to handle large numbers)';

-- Drop and recreate the index since the column type changed
DROP INDEX IF EXISTS idx_call_logs_onecom_te_id;
CREATE INDEX IF NOT EXISTS idx_call_logs_onecom_te_id 
ON call_logs(onecom_te_id);

-- Verify the change
SELECT column_name, data_type, character_maximum_length 
FROM information_schema.columns 
WHERE table_name = 'call_logs' 
AND column_name = 'onecom_te_id';
