-- Simple one-step fix: Add all columns, then create indexes
-- Run this in Supabase SQL Editor

-- Step 1: Add all missing columns
ALTER TABLE whatsapp_templates 
ADD COLUMN IF NOT EXISTS whatsapp_template_id TEXT,
ADD COLUMN IF NOT EXISTS name TEXT,
ADD COLUMN IF NOT EXISTS language TEXT DEFAULT 'en_US',
ADD COLUMN IF NOT EXISTS content TEXT,
ADD COLUMN IF NOT EXISTS params TEXT DEFAULT '0',
ADD COLUMN IF NOT EXISTS active BOOLEAN DEFAULT true,
ADD COLUMN IF NOT EXISTS created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW();

-- Step 2: Create indexes (only runs if columns exist now)
CREATE INDEX IF NOT EXISTS idx_whatsapp_templates_whatsapp_id ON whatsapp_templates(whatsapp_template_id);
CREATE INDEX IF NOT EXISTS idx_whatsapp_templates_name_language ON whatsapp_templates(name, language);
CREATE INDEX IF NOT EXISTS idx_whatsapp_templates_active ON whatsapp_templates(active);

-- Step 3: Verify structure
SELECT column_name, data_type 
FROM information_schema.columns 
WHERE table_name = 'whatsapp_templates'
ORDER BY ordinal_position;

