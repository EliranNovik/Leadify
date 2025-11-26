-- Create perfect whatsapp_templates table from scratch
-- This drops the old table and creates a brand new clean one

-- Step 1: Drop the existing table (if you want to keep old data, comment this out and backup first)
DROP TABLE IF EXISTS whatsapp_templates CASCADE;

-- Step 2: Create the perfect new table with auto-incrementing id
CREATE TABLE whatsapp_templates (
    id BIGSERIAL PRIMARY KEY, -- Auto-incrementing: 1, 2, 3, 4...
    whatsapp_template_id TEXT NOT NULL UNIQUE, -- The actual WhatsApp template ID from Meta API
    name TEXT NOT NULL, -- Template name (e.g., "email_request")
    language TEXT NOT NULL DEFAULT 'en_US', -- Language code (e.g., "en_US", "de", "he")
    params TEXT NOT NULL DEFAULT '0', -- '0' = no params, '1' = has params (for variables like {{1}})
    active BOOLEAN NOT NULL DEFAULT true, -- Whether template is active
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Step 3: Create indexes for fast lookups
CREATE INDEX idx_whatsapp_templates_whatsapp_id ON whatsapp_templates(whatsapp_template_id);
CREATE INDEX idx_whatsapp_templates_name_language ON whatsapp_templates(name, language);
CREATE INDEX idx_whatsapp_templates_active ON whatsapp_templates(active);

-- Step 4: Add comments
COMMENT ON TABLE whatsapp_templates IS 'WhatsApp message templates synced from Meta Business Manager. id is auto-incrementing (1,2,3...), whatsapp_template_id is the unique ID from WhatsApp API.';
COMMENT ON COLUMN whatsapp_templates.id IS 'Auto-incrementing primary key (1, 2, 3, 4...) - this is saved in whatsapp_messages.template_id';
COMMENT ON COLUMN whatsapp_templates.whatsapp_template_id IS 'The unique WhatsApp template ID from Meta API (stored as text)';

-- Step 5: Verify the table was created correctly
SELECT 
    column_name, 
    data_type, 
    is_nullable,
    column_default
FROM information_schema.columns 
WHERE table_name = 'whatsapp_templates'
ORDER BY ordinal_position;

-- Step 6: Show table is empty and ready
SELECT COUNT(*) as template_count FROM whatsapp_templates;

SELECT '✅ Perfect whatsapp_templates table created successfully!' AS status;

