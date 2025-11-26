-- Cleanup and fix existing whatsapp_templates table
-- This script:
-- 1. Removes content column
-- 2. Changes id from UUID to BIGSERIAL (1, 2, 3, 4...)
-- 3. Ensures proper structure with essential columns only

-- Step 1: Check current structure
SELECT column_name, data_type 
FROM information_schema.columns 
WHERE table_name = 'whatsapp_templates'
ORDER BY ordinal_position;

-- Step 2: Drop content column (not needed)
ALTER TABLE whatsapp_templates 
DROP COLUMN IF EXISTS content;

-- Step 3: Create new table with BIGSERIAL id and clean structure
CREATE TABLE IF NOT EXISTS whatsapp_templates_clean (
    id BIGSERIAL PRIMARY KEY, -- Auto-incrementing: 1, 2, 3, 4...
    whatsapp_template_id TEXT NOT NULL UNIQUE, -- The actual WhatsApp template ID from Meta API
    name TEXT NOT NULL, -- Template name (e.g., "email_request")
    language TEXT NOT NULL DEFAULT 'en_US', -- Language code (e.g., "en_US", "de", "he")
    params TEXT NOT NULL DEFAULT '0', -- '0' = no params, '1' = has params (for variables like {{1}})
    active BOOLEAN NOT NULL DEFAULT true, -- Whether template is active
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Step 4: Migrate data from old table to new clean table
-- Use whatsapp_template_id if exists, otherwise use number_id, otherwise generate from UUID
INSERT INTO whatsapp_templates_clean (whatsapp_template_id, name, language, params, active, created_at, updated_at)
SELECT DISTINCT ON (COALESCE(whatsapp_template_id, CAST(number_id AS TEXT), CONCAT('legacy_', id::TEXT)))
    COALESCE(whatsapp_template_id, CAST(number_id AS TEXT), CONCAT('legacy_', id::TEXT)) AS whatsapp_template_id,
    COALESCE(name, name360, title, 'unknown') AS name,
    COALESCE(language, 'en_US') AS language,
    COALESCE(params, '0') AS params,
    COALESCE(active, is_active, true) AS active,
    COALESCE(created_at, NOW()) AS created_at,
    COALESCE(updated_at, NOW()) AS updated_at
FROM whatsapp_templates
WHERE COALESCE(whatsapp_template_id, CAST(number_id AS TEXT), CONCAT('legacy_', id::TEXT)) IS NOT NULL
ON CONFLICT (whatsapp_template_id) DO NOTHING;

-- Step 5: Backup old table
ALTER TABLE whatsapp_templates RENAME TO whatsapp_templates_old_uuid_backup;

-- Step 6: Rename clean table to final name
ALTER TABLE whatsapp_templates_clean RENAME TO whatsapp_templates;

-- Step 7: Create indexes
CREATE INDEX IF NOT EXISTS idx_whatsapp_templates_whatsapp_id ON whatsapp_templates(whatsapp_template_id);
CREATE INDEX IF NOT EXISTS idx_whatsapp_templates_name_language ON whatsapp_templates(name, language);
CREATE INDEX IF NOT EXISTS idx_whatsapp_templates_active ON whatsapp_templates(active);

-- Step 8: Add comments
COMMENT ON TABLE whatsapp_templates IS 'WhatsApp message templates synced from Meta Business Manager. id is auto-incrementing (1,2,3...), whatsapp_template_id is the unique ID from WhatsApp API.';
COMMENT ON COLUMN whatsapp_templates.id IS 'Auto-incrementing primary key (1, 2, 3, 4...) - this is saved in whatsapp_messages.template_id';
COMMENT ON COLUMN whatsapp_templates.whatsapp_template_id IS 'The unique WhatsApp template ID from Meta API (stored as text)';

-- Step 9: Verify new structure
SELECT column_name, data_type, is_nullable, column_default
FROM information_schema.columns 
WHERE table_name = 'whatsapp_templates'
ORDER BY ordinal_position;

-- Step 10: Show migrated count
SELECT COUNT(*) as migrated_template_count FROM whatsapp_templates;

