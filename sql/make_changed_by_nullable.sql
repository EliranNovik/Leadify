-- Make changed_by column nullable to fix foreign key constraint errors
-- This allows the system to work even when the current user doesn't exist in the users table

-- Make the changed_by column nullable
ALTER TABLE user_changes_history ALTER COLUMN changed_by DROP NOT NULL;

-- Drop the existing foreign key constraint
ALTER TABLE user_changes_history DROP CONSTRAINT IF EXISTS user_changes_history_changed_by_fkey;

-- Add the constraint back with ON DELETE SET NULL to handle missing users gracefully
ALTER TABLE user_changes_history ADD CONSTRAINT user_changes_history_changed_by_fkey 
    FOREIGN KEY (changed_by) REFERENCES users(id) ON DELETE SET NULL; 