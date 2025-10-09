-- Add 1com specific columns to call_logs table
-- This script adds columns needed to store 1com API data

-- Add onecom_uniqueid column to store the unique ID from 1com
ALTER TABLE call_logs 
ADD COLUMN IF NOT EXISTS onecom_uniqueid TEXT;

-- Add onecom_te_id column to store the tenant extension ID from 1com
ALTER TABLE call_logs 
ADD COLUMN IF NOT EXISTS onecom_te_id INTEGER;

-- Add onecom_raw_data column to store the complete raw data from 1com API
ALTER TABLE call_logs 
ADD COLUMN IF NOT EXISTS onecom_raw_data JSONB;

-- Create index on onecom_uniqueid for faster lookups during sync
CREATE INDEX IF NOT EXISTS idx_call_logs_onecom_uniqueid 
ON call_logs(onecom_uniqueid);

-- Create index on onecom_te_id for faster lookups
CREATE INDEX IF NOT EXISTS idx_call_logs_onecom_te_id 
ON call_logs(onecom_te_id);

-- Add comment to the table
COMMENT ON TABLE call_logs IS 'Call logs table with 1com API integration support';

-- Add comments to the new columns
COMMENT ON COLUMN call_logs.onecom_uniqueid IS 'Unique ID from 1com API (e.g., pbx24-1754337031.4317807)';
COMMENT ON COLUMN call_logs.onecom_te_id IS 'Tenant extension ID from 1com API';
COMMENT ON COLUMN call_logs.onecom_raw_data IS 'Complete raw data from 1com API in JSON format';

-- Create a function to get sync statistics
CREATE OR REPLACE FUNCTION get_onecom_sync_stats()
RETURNS TABLE (
    total_records BIGINT,
    onecom_records BIGINT,
    last_24h_records BIGINT,
    last_sync_date TIMESTAMP WITH TIME ZONE
) AS $$
BEGIN
    RETURN QUERY
    SELECT 
        (SELECT COUNT(*) FROM call_logs) as total_records,
        (SELECT COUNT(*) FROM call_logs WHERE onecom_uniqueid IS NOT NULL) as onecom_records,
        (SELECT COUNT(*) FROM call_logs WHERE cdate >= NOW() - INTERVAL '24 hours') as last_24h_records,
        (SELECT MAX(cdate) FROM call_logs WHERE onecom_uniqueid IS NOT NULL) as last_sync_date;
END;
$$ LANGUAGE plpgsql;

-- Create a function to clean old 1com data (optional maintenance)
CREATE OR REPLACE FUNCTION cleanup_old_onecom_data(days_to_keep INTEGER DEFAULT 90)
RETURNS INTEGER AS $$
DECLARE
    deleted_count INTEGER;
BEGIN
    DELETE FROM call_logs 
    WHERE onecom_uniqueid IS NOT NULL 
    AND cdate < NOW() - (days_to_keep || ' days')::INTERVAL;
    
    GET DIAGNOSTICS deleted_count = ROW_COUNT;
    RETURN deleted_count;
END;
$$ LANGUAGE plpgsql;

-- Example usage:
-- SELECT * FROM get_onecom_sync_stats();
-- SELECT cleanup_old_onecom_data(90); -- Keep last 90 days

-- Add RLS policy for onecom data access (if RLS is enabled)
-- This allows users to read 1com synced data
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'call_logs' AND policyname = 'call_logs_select_policy') THEN
        -- Update existing policy to include onecom columns
        DROP POLICY IF EXISTS call_logs_select_policy ON call_logs;
        CREATE POLICY call_logs_select_policy ON call_logs
            FOR SELECT
            USING (true); -- Adjust this based on your RLS requirements
    END IF;
END $$;
