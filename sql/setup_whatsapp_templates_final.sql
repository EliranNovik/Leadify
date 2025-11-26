-- FINAL SIMPLE SETUP - Create perfect whatsapp_templates table
-- Run this once to create a clean table from scratch

-- Drop old table completely (clean slate)
DROP TABLE IF EXISTS whatsapp_templates CASCADE;

-- Create perfect new table
CREATE TABLE whatsapp_templates (
    id BIGSERIAL PRIMARY KEY,
    whatsapp_template_id TEXT NOT NULL UNIQUE,
    name TEXT NOT NULL,
    language TEXT NOT NULL DEFAULT 'en_US',
    params TEXT NOT NULL DEFAULT '0',
    active BOOLEAN NOT NULL DEFAULT true,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Create indexes
CREATE INDEX idx_whatsapp_templates_whatsapp_id ON whatsapp_templates(whatsapp_template_id);
CREATE INDEX idx_whatsapp_templates_name_language ON whatsapp_templates(name, language);
CREATE INDEX idx_whatsapp_templates_active ON whatsapp_templates(active);

-- Verify
SELECT 'Table created!' AS status;
SELECT column_name, data_type FROM information_schema.columns 
WHERE table_name = 'whatsapp_templates' ORDER BY ordinal_position;

