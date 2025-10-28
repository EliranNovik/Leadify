-- Add category tracking columns to leads table
-- This migration adds the missing category_last_edited_at and category_last_edited_by columns

-- Category tracking columns for leads table
ALTER TABLE leads ADD COLUMN IF NOT EXISTS category_last_edited_by TEXT;
ALTER TABLE leads ADD COLUMN IF NOT EXISTS category_last_edited_at TIMESTAMP WITH TIME ZONE;

-- Add comments to document the new columns
COMMENT ON COLUMN leads.category_last_edited_by IS 'User who last edited category/tags';
COMMENT ON COLUMN leads.category_last_edited_at IS 'Timestamp when category/tags were last edited';

-- Add index for performance on commonly queried column
CREATE INDEX IF NOT EXISTS idx_leads_category_edited_at ON leads(category_last_edited_at);
