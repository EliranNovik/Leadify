-- Add legacy_id column to contracts table for legacy lead support
-- This allows contracts to reference legacy leads from leads_lead table

-- Check if legacy_id column already exists
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'contracts' 
        AND column_name = 'legacy_id'
    ) THEN
        -- Add legacy_id column
        ALTER TABLE contracts ADD COLUMN legacy_id BIGINT;
        
        -- Add comment
        COMMENT ON COLUMN contracts.legacy_id IS 'Reference to legacy lead ID in leads_lead table';
        
        RAISE NOTICE 'Added legacy_id column to contracts table';
    ELSE
        RAISE NOTICE 'legacy_id column already exists in contracts table';
    END IF;
END $$;

-- Verify the column was added
SELECT 
    column_name, 
    data_type, 
    is_nullable,
    column_default
FROM information_schema.columns 
WHERE table_name = 'contracts' 
AND column_name IN ('client_id', 'legacy_id')
ORDER BY column_name;
