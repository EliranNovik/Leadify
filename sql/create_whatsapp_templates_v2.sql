-- Create brand new whatsapp_templates_v2 table - no conflicts, no drops
-- This is a fresh table with a new name

CREATE TABLE whatsapp_templates_v2 (
    id BIGSERIAL PRIMARY KEY,
    whatsapp_template_id TEXT NOT NULL UNIQUE,
    name TEXT NOT NULL,
    language TEXT NOT NULL DEFAULT 'en_US',
    content TEXT NOT NULL, -- The actual template message text
    params TEXT NOT NULL DEFAULT '0',
    active BOOLEAN NOT NULL DEFAULT true,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX idx_whatsapp_templates_v2_whatsapp_id ON whatsapp_templates_v2(whatsapp_template_id);
CREATE INDEX idx_whatsapp_templates_v2_name_language ON whatsapp_templates_v2(name, language);
CREATE INDEX idx_whatsapp_templates_v2_active ON whatsapp_templates_v2(active);
