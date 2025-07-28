-- Final fix for updated_by constraint issues
-- Make updated_by nullable and remove foreign key constraint

-- Make updated_by nullable
ALTER TABLE users ALTER COLUMN updated_by DROP NOT NULL;

-- Drop the foreign key constraint if it exists
ALTER TABLE users DROP CONSTRAINT IF EXISTS users_updated_by_fkey;

-- Add a new foreign key constraint that allows NULL values
ALTER TABLE users ADD CONSTRAINT users_updated_by_fkey 
FOREIGN KEY (updated_by) REFERENCES users(id) ON DELETE SET NULL;

-- Update any existing NULL values to be properly NULL
UPDATE users SET updated_by = NULL WHERE updated_by = 'undefined' OR updated_by IS NULL; 