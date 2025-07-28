-- Fix the updated_by foreign key constraint
-- This makes the constraint more flexible to handle missing users

-- Make the updated_by column nullable
ALTER TABLE users ALTER COLUMN updated_by DROP NOT NULL;

-- Drop the existing foreign key constraint if it exists
ALTER TABLE users DROP CONSTRAINT IF EXISTS users_updated_by_fkey;

-- Add the constraint back with ON DELETE SET NULL to handle missing users gracefully
ALTER TABLE users ADD CONSTRAINT users_updated_by_fkey 
    FOREIGN KEY (updated_by) REFERENCES users(id) ON DELETE SET NULL; 