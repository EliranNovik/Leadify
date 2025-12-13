-- Add notes column to conversations table for group chat notes
-- This allows storing additional notes about the group chat

ALTER TABLE public.conversations
ADD COLUMN IF NOT EXISTS notes TEXT NULL;

-- Add comment to the column for documentation
COMMENT ON COLUMN public.conversations.notes IS 'Additional notes about the group conversation';

-- The description column already exists from the initial schema
-- If it doesn't exist, uncomment the line below:
-- ALTER TABLE public.conversations ADD COLUMN IF NOT EXISTS description TEXT NULL;

