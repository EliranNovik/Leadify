-- Convert existing whatsapp_templates table to clean structure
-- This script will:
-- 1. Change id from UUID to BIGSERIAL (auto-incrementing 1, 2, 3, 4...)
-- 2. Remove content column (not needed)
-- 3. Keep only essential columns
-- 4. Preserve existing data

-- Step 1: Create new clean table with BIGSERIAL id
CREATE TABLE IF NOT EXISTS whatsapp_templates_clean (
    id BIGSERIAL PRIMARY KEY, -- Auto-incrementing: 1, 2, 3, 4...
    whatsapp_template_id TEXT NOT NULL UNIQUE, -- The actual WhatsApp template ID from Meta API
    name TEXT NOT NULL, -- Template name (e.g., "email_request")
    language TEXT NOT NULL DEFAULT 'en_US', -- Language code
    params TEXT NOT NULL DEFAULT '0', -- '0' = no params, '1' = has params
    active BOOLEAN NOT NULL DEFAULT true,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Step 2: Migrate data from existing table to new clean table
INSERT INTO whatsapp_templates_clean (whatsapp_template_id, name, language, params, active, created_at, updated_at)
SELECT DISTINCT ON (
    COALESCE(
        whatsapp_template_id, 
        CAST(number_id AS TEXT), 
        CONCAT('legacy_', id::TEXT)
    )
)
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

-- Step 3: Backup old table
ALTER TABLE whatsapp_templates RENAME TO whatsapp_templates_uuid_backup;

-- Step 4: Rename clean table to final name
ALTER TABLE whatsapp_templates_clean RENAME TO whatsapp_templates;

-- Step 5: Create indexes
CREATE INDEX IF NOT EXISTS idx_whatsapp_templates_whatsapp_id ON whatsapp_templates(whatsapp_template_id);
CREATE INDEX IF NOT EXISTS idx_whatsapp_templates_name_language ON whatsapp_templates(name, language);
CREATE INDEX IF NOT EXISTS idx_whatsapp_templates_active ON whatsapp_templates(active);

-- Step 6: Verify structure
SELECT column_name, data_type 
FROM information_schema.columns 
WHERE table_name = 'whatsapp_templates'
ORDER BY ordinal_position;

SELECT COUNT(*) as template_count FROM whatsapp_templates;

