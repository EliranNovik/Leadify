-- Create new simplified whatsapp_templates table with auto-incrementing id
-- This replaces whatsapp_whatsapptemplate with a cleaner structure

-- Drop old table if exists (be careful - backup first!)
-- DROP TABLE IF EXISTS whatsapp_templates CASCADE;

-- Create new whatsapp_templates table with essential columns only
CREATE TABLE IF NOT EXISTS whatsapp_templates (
    id BIGSERIAL PRIMARY KEY, -- Auto-incrementing: 1, 2, 3, 4...
    whatsapp_template_id TEXT NOT NULL UNIQUE, -- The actual WhatsApp template ID from Meta API (e.g., "123456789")
    name TEXT NOT NULL, -- Template name (e.g., "email_request")
    language TEXT NOT NULL DEFAULT 'en_US', -- Language code (e.g., "en_US", "de", "he")
    content TEXT, -- Template content/body text
    params TEXT NOT NULL DEFAULT '0', -- '0' = no params, '1' = has params (for variables like {{1}})
    active BOOLEAN NOT NULL DEFAULT true, -- Whether template is active
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Create index on whatsapp_template_id for fast lookups
CREATE INDEX IF NOT EXISTS idx_whatsapp_templates_whatsapp_id ON whatsapp_templates(whatsapp_template_id);

-- Create index on name+language for matching
CREATE INDEX IF NOT EXISTS idx_whatsapp_templates_name_language ON whatsapp_templates(name, language);

-- Create index on active status for filtering
CREATE INDEX IF NOT EXISTS idx_whatsapp_templates_active ON whatsapp_templates(active);

-- Add comment for documentation
COMMENT ON TABLE whatsapp_templates IS 'WhatsApp message templates synced from Meta Business Manager. id is auto-incrementing (1,2,3...), whatsapp_template_id is the unique ID from WhatsApp API.';
COMMENT ON COLUMN whatsapp_templates.id IS 'Auto-incrementing primary key (1, 2, 3, 4...) - this is saved in whatsapp_messages.template_id';
COMMENT ON COLUMN whatsapp_templates.whatsapp_template_id IS 'The unique WhatsApp template ID from Meta API (stored as text)';
COMMENT ON COLUMN whatsapp_templates.params IS '0 = no parameters, 1 = has parameters (variables like {{1}})';

