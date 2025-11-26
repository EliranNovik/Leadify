-- SIMPLE: Create perfect whatsapp_templates table
-- Just run this - it drops the old one and creates a brand new clean table

DROP TABLE IF EXISTS whatsapp_templates CASCADE;

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

CREATE INDEX idx_whatsapp_templates_whatsapp_id ON whatsapp_templates(whatsapp_template_id);
CREATE INDEX idx_whatsapp_templates_name_language ON whatsapp_templates(name, language);
CREATE INDEX idx_whatsapp_templates_active ON whatsapp_templates(active);

