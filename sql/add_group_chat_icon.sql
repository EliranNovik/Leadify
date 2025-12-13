-- Add icon_url column to conversations table for group chat custom icons
-- This allows storing a custom image URL for the group chat icon

ALTER TABLE public.conversations
ADD COLUMN IF NOT EXISTS icon_url TEXT NULL;

-- Add comment to the column for documentation
COMMENT ON COLUMN public.conversations.icon_url IS 'URL of custom icon/avatar image for the group conversation, stored in RMQ-Groups bucket';

