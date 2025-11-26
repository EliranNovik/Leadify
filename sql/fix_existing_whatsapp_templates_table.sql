-- Fix existing whatsapp_templates table
-- 1. Remove content column
-- 2. Change id from UUID to BIGSERIAL (auto-incrementing 1, 2, 3, 4...)
-- 3. Clean up duplicate/conflicting columns

-- Step 1: Check current structure
SELECT column_name, data_type 
FROM information_schema.columns 
WHERE table_name = 'whatsapp_templates'
ORDER BY ordinal_position;

-- Step 2: Drop content column (user says it's wrong and not needed)
ALTER TABLE whatsapp_templates 
DROP COLUMN IF EXISTS content;

-- Step 3: Create a new table with BIGSERIAL id
CREATE TABLE IF NOT EXISTS whatsapp_templates_new (
    id BIGSERIAL PRIMARY KEY, -- Auto-incrementing: 1, 2, 3, 4...
    whatsapp_template_id TEXT NOT NULL UNIQUE, -- The actual WhatsApp template ID from Meta API
    name TEXT NOT NULL, -- Template name (e.g., "email_request")
    language TEXT NOT NULL DEFAULT 'en_US', -- Language code (e.g., "en_US", "de", "he")
    params TEXT NOT NULL DEFAULT '0', -- '0' = no params, '1' = has params
    active BOOLEAN NOT NULL DEFAULT true, -- Whether template is active
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Step 4: Migrate data from old table to new table
INSERT INTO whatsapp_templates_new (whatsapp_template_id, name, language, params, active, created_at, updated_at)
SELECT 
    COALESCE(whatsapp_template_id, CAST(number_id AS TEXT), CONCAT('legacy_', id::TEXT)) AS whatsapp_template_id,
    COALESCE(name, name360, title, 'unknown') AS name,
    COALESCE(language, 'en_US') AS language,
    COALESCE(params, '0') AS params,
    COALESCE(active, is_active, true) AS active,
    created_at,
    updated_at
FROM whatsapp_templates
WHERE NOT EXISTS (
    SELECT 1 FROM whatsapp_templates_new 
    WHERE whatsapp_templates_new.whatsapp_template_id = COALESCE(whatsapp_templates.whatsapp_template_id, CAST(whatsapp_templates.number_id AS TEXT), CONCAT('legacy_', whatsapp_templates.id::TEXT))
)
ON CONFLICT (whatsapp_template_id) DO NOTHING;

-- Step 5: Create indexes on new table
CREATE INDEX IF NOT EXISTS idx_whatsapp_templates_new_whatsapp_id ON whatsapp_templates_new(whatsapp_template_id);
CREATE INDEX IF NOT EXISTS idx_whatsapp_templates_new_name_language ON whatsapp_templates_new(name, language);
CREATE INDEX IF NOT EXISTS idx_whatsapp_templates_new_active ON whatsapp_templates_new(active);

-- Step 6: Backup old table
ALTER TABLE whatsapp_templates RENAME TO whatsapp_templates_old_backup;

-- Step 7: Rename new table to final name
ALTER TABLE whatsapp_templates_new RENAME TO whatsapp_templates;

-- Step 8: Verify new table structure
SELECT column_name, data_type 
FROM information_schema.columns 
WHERE table_name = 'whatsapp_templates'
ORDER BY ordinal_position;

SELECT COUNT(*) as template_count FROM whatsapp_templates;

-- Step 9: Update foreign key in whatsapp_messages (if needed)
-- Note: You'll need to map old UUID IDs to new BIGSERIAL IDs
-- This is complex - see migration script for details

