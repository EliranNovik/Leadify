-- Complete setup script for whatsapp_templates table
-- This adds ALL missing columns first, then creates indexes

-- Step 1: Check current table structure
SELECT 
    column_name, 
    data_type 
FROM information_schema.columns 
WHERE table_name = 'whatsapp_templates'
ORDER BY ordinal_position;

-- Step 2: Add all required columns (safe - won't duplicate if they exist)
ALTER TABLE whatsapp_templates 
ADD COLUMN IF NOT EXISTS whatsapp_template_id TEXT,
ADD COLUMN IF NOT EXISTS name TEXT,
ADD COLUMN IF NOT EXISTS language TEXT DEFAULT 'en_US',
ADD COLUMN IF NOT EXISTS content TEXT,
ADD COLUMN IF NOT EXISTS params TEXT DEFAULT '0',
ADD COLUMN IF NOT EXISTS active BOOLEAN DEFAULT true,
ADD COLUMN IF NOT EXISTS created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW();

-- Step 3: Ensure id column exists and is primary key (if not already)
DO $$
BEGIN
    -- Check if id column exists
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'whatsapp_templates' 
        AND column_name = 'id'
    ) THEN
        -- Add id as primary key
        ALTER TABLE whatsapp_templates 
        ADD COLUMN id BIGSERIAL PRIMARY KEY;
        RAISE NOTICE 'Added id column as BIGSERIAL PRIMARY KEY';
    ELSE
        RAISE NOTICE 'Id column already exists';
    END IF;
END $$;

-- Step 4: Add unique constraint on whatsapp_template_id (with error handling)
DO $$
BEGIN
    -- First, set a default value for any NULL whatsapp_template_id values
    UPDATE whatsapp_templates 
    SET whatsapp_template_id = CONCAT('temp_', COALESCE(id, ROW_NUMBER() OVER ())::TEXT)
    WHERE whatsapp_template_id IS NULL;
    
    -- Now try to add unique constraint
    ALTER TABLE whatsapp_templates 
    ADD CONSTRAINT whatsapp_templates_whatsapp_template_id_key UNIQUE (whatsapp_template_id);
    RAISE NOTICE 'Added unique constraint on whatsapp_template_id';
EXCEPTION WHEN duplicate_object THEN
    RAISE NOTICE 'Unique constraint already exists';
WHEN OTHERS THEN
    RAISE NOTICE 'Could not add unique constraint: %', SQLERRM;
END $$;

-- Step 5: Create indexes (only after columns exist)
CREATE INDEX IF NOT EXISTS idx_whatsapp_templates_whatsapp_id 
ON whatsapp_templates(whatsapp_template_id);

CREATE INDEX IF NOT EXISTS idx_whatsapp_templates_name_language 
ON whatsapp_templates(name, language);

CREATE INDEX IF NOT EXISTS idx_whatsapp_templates_active 
ON whatsapp_templates(active);

-- Step 6: Verify final structure
SELECT 
    column_name, 
    data_type, 
    is_nullable,
    column_default
FROM information_schema.columns 
WHERE table_name = 'whatsapp_templates'
ORDER BY ordinal_position;

-- Step 7: Show current count
SELECT COUNT(*) as template_count FROM whatsapp_templates;

