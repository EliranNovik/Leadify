-- Add param_mapping JSONB column to whatsapp_templates_v2 table
-- This allows storing custom parameter definitions per template

ALTER TABLE whatsapp_templates_v2
ADD COLUMN IF NOT EXISTS param_mapping JSONB DEFAULT NULL;

-- Add index for JSONB queries
CREATE INDEX IF NOT EXISTS idx_whatsapp_templates_v2_param_mapping ON whatsapp_templates_v2 USING GIN (param_mapping);

-- Example param_mapping structure:
-- [
--   { "type": "contact_name", "order": 1 },
--   { "type": "meeting_datetime", "order": 2 }
-- ]

