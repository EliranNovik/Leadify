-- Make client_id column nullable in contracts table
-- This allows contracts to be created for legacy leads without a client_id

-- Check current nullable status
SELECT 
    column_name, 
    is_nullable
FROM information_schema.columns 
WHERE table_name = 'contracts' 
AND column_name = 'client_id';

-- Make client_id nullable if it's not already
DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'contracts' 
        AND column_name = 'client_id'
        AND is_nullable = 'NO'
    ) THEN
        ALTER TABLE contracts ALTER COLUMN client_id DROP NOT NULL;
        RAISE NOTICE 'Made client_id column nullable';
    ELSE
        RAISE NOTICE 'client_id column is already nullable';
    END IF;
END $$;

-- Verify the change
SELECT 
    column_name, 
    is_nullable
FROM information_schema.columns 
WHERE table_name = 'contracts' 
AND column_name = 'client_id';
