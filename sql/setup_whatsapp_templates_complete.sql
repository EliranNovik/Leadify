-- Complete setup script for new whatsapp_templates table
-- This script safely creates the table and handles existing data

-- Step 1: Check if table exists and create it
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'whatsapp_templates') THEN
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
        
        CREATE INDEX idx_whatsapp_templates_whatsapp_id ON whatsapp_templates(whatsapp_template_id);
        CREATE INDEX idx_whatsapp_templates_name_language ON whatsapp_templates(name, language);
        CREATE INDEX idx_whatsapp_templates_active ON whatsapp_templates(active);
        
        COMMENT ON TABLE whatsapp_templates IS 'WhatsApp message templates synced from Meta Business Manager. id is auto-incrementing (1,2,3...), whatsapp_template_id is the unique ID from WhatsApp API.';
        COMMENT ON COLUMN whatsapp_templates.id IS 'Auto-incrementing primary key (1, 2, 3, 4...) - this is saved in whatsapp_messages.template_id';
        COMMENT ON COLUMN whatsapp_templates.whatsapp_template_id IS 'The unique WhatsApp template ID from Meta API (stored as text)';
        
        RAISE NOTICE '✅ Created whatsapp_templates table';
    ELSE
        RAISE NOTICE 'ℹ️ whatsapp_templates table already exists';
    END IF;
END $$;

-- Step 2: Verify table structure
SELECT 
    column_name, 
    data_type, 
    is_nullable,
    column_default
FROM information_schema.columns 
WHERE table_name = 'whatsapp_templates'
ORDER BY ordinal_position;

-- Step 3: Show table info
SELECT 
    COUNT(*) as current_template_count
FROM whatsapp_templates;

