-- SAFE DROP AND RECREATE whatsapp_templates table
-- ⚠️ WARNING: This will delete all existing templates in the table!
-- Only run this if you want to start fresh

-- Step 1: Backup existing data (if any)
CREATE TABLE IF NOT EXISTS whatsapp_templates_backup AS 
SELECT * FROM whatsapp_templates;

-- Step 2: Drop the table (this will also drop all indexes and constraints)
DROP TABLE IF EXISTS whatsapp_templates CASCADE;

-- Step 3: Create the table with correct structure
CREATE TABLE whatsapp_templates (
    id BIGSERIAL PRIMARY KEY,
    whatsapp_template_id TEXT NOT NULL UNIQUE,
    name TEXT NOT NULL,
    language TEXT NOT NULL DEFAULT 'en_US',
    content TEXT,
    params TEXT NOT NULL DEFAULT '0',
    active BOOLEAN NOT NULL DEFAULT true,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Step 4: Create indexes
CREATE INDEX idx_whatsapp_templates_whatsapp_id ON whatsapp_templates(whatsapp_template_id);
CREATE INDEX idx_whatsapp_templates_name_language ON whatsapp_templates(name, language);
CREATE INDEX idx_whatsapp_templates_active ON whatsapp_templates(active);

-- Step 5: Add comments
COMMENT ON TABLE whatsapp_templates IS 'WhatsApp message templates synced from Meta Business Manager. id is auto-incrementing (1,2,3...), whatsapp_template_id is the unique ID from WhatsApp API.';
COMMENT ON COLUMN whatsapp_templates.id IS 'Auto-incrementing primary key (1, 2, 3, 4...) - this is saved in whatsapp_messages.template_id';
COMMENT ON COLUMN whatsapp_templates.whatsapp_template_id IS 'The unique WhatsApp template ID from Meta API (stored as text)';

-- Step 6: Verify
SELECT 
    column_name, 
    data_type, 
    is_nullable
FROM information_schema.columns 
WHERE table_name = 'whatsapp_templates'
ORDER BY ordinal_position;

SELECT 'Table recreated successfully!' AS status;

