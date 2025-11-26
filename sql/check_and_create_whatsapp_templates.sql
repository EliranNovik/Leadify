-- Safe script to check and create whatsapp_templates table
-- Run this first before any other scripts

-- Step 1: Check if table exists
SELECT EXISTS (
    SELECT FROM information_schema.tables 
    WHERE table_schema = 'public' 
    AND table_name = 'whatsapp_templates'
) AS table_exists;

-- Step 2: Create table only if it doesn't exist
CREATE TABLE IF NOT EXISTS whatsapp_templates (
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

-- Step 3: Create indexes (safe to run multiple times)
CREATE INDEX IF NOT EXISTS idx_whatsapp_templates_whatsapp_id ON whatsapp_templates(whatsapp_template_id);
CREATE INDEX IF NOT EXISTS idx_whatsapp_templates_name_language ON whatsapp_templates(name, language);
CREATE INDEX IF NOT EXISTS idx_whatsapp_templates_active ON whatsapp_templates(active);

-- Step 4: Verify table structure
SELECT 
    column_name, 
    data_type, 
    is_nullable,
    column_default
FROM information_schema.columns 
WHERE table_name = 'whatsapp_templates'
ORDER BY ordinal_position;

-- Step 5: Show current count
SELECT COUNT(*) as template_count FROM whatsapp_templates;

