-- Fix whatsapp_templates table structure
-- This script checks if the table exists and fixes it if needed

-- Step 1: Check if table exists and what columns it has
DO $$
BEGIN
    -- Check if table exists
    IF EXISTS (SELECT FROM information_schema.tables WHERE table_name = 'whatsapp_templates') THEN
        RAISE NOTICE 'Table whatsapp_templates exists. Checking structure...';
        
        -- Check if whatsapp_template_id column exists
        IF NOT EXISTS (
            SELECT 1 FROM information_schema.columns 
            WHERE table_name = 'whatsapp_templates' 
            AND column_name = 'whatsapp_template_id'
        ) THEN
            RAISE NOTICE 'Column whatsapp_template_id does not exist. Adding it...';
            
            -- Add the missing column
            ALTER TABLE whatsapp_templates 
            ADD COLUMN IF NOT EXISTS whatsapp_template_id TEXT;
            
            -- Make it unique if it doesn't have a unique constraint
            -- Note: This will fail if there are duplicate NULLs, so we handle that
            DO $$
            BEGIN
                -- Remove duplicates first by setting a unique value for NULLs
                UPDATE whatsapp_templates 
                SET whatsapp_template_id = CONCAT('temp_', id::TEXT) 
                WHERE whatsapp_template_id IS NULL;
                
                -- Now add unique constraint
                ALTER TABLE whatsapp_templates 
                ADD CONSTRAINT whatsapp_templates_whatsapp_template_id_key UNIQUE (whatsapp_template_id);
            EXCEPTION WHEN OTHERS THEN
                RAISE NOTICE 'Could not add unique constraint: %', SQLERRM;
            END $$;
            
            RAISE NOTICE '✅ Added whatsapp_template_id column';
        ELSE
            RAISE NOTICE 'Column whatsapp_template_id already exists';
        END IF;
        
        -- Ensure other required columns exist
        ALTER TABLE whatsapp_templates 
        ADD COLUMN IF NOT EXISTS name TEXT,
        ADD COLUMN IF NOT EXISTS language TEXT DEFAULT 'en_US',
        ADD COLUMN IF NOT EXISTS content TEXT,
        ADD COLUMN IF NOT EXISTS params TEXT DEFAULT '0',
        ADD COLUMN IF NOT EXISTS active BOOLEAN DEFAULT true,
        ADD COLUMN IF NOT EXISTS created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
        ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW();
        
        -- Ensure id is auto-incrementing if it's not already
        -- Check if id column exists and is the right type
        IF EXISTS (
            SELECT 1 FROM information_schema.columns 
            WHERE table_name = 'whatsapp_templates' 
            AND column_name = 'id'
        ) THEN
            -- If id exists but is not BIGSERIAL, we might need to recreate the table
            -- But that's risky, so we'll just ensure it's a bigint primary key
            RAISE NOTICE 'Id column exists';
        ELSE
            -- Add id column as primary key
            ALTER TABLE whatsapp_templates ADD COLUMN id BIGSERIAL PRIMARY KEY;
            RAISE NOTICE '✅ Added id column as BIGSERIAL';
        END IF;
        
    ELSE
        RAISE NOTICE 'Table does not exist. Creating it...';
        
        -- Create table from scratch
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
        
        RAISE NOTICE '✅ Created whatsapp_templates table';
    END IF;
END $$;

-- Step 2: Create indexes (safe to run multiple times)
CREATE INDEX IF NOT EXISTS idx_whatsapp_templates_whatsapp_id ON whatsapp_templates(whatsapp_template_id);
CREATE INDEX IF NOT EXISTS idx_whatsapp_templates_name_language ON whatsapp_templates(name, language);
CREATE INDEX IF NOT EXISTS idx_whatsapp_templates_active ON whatsapp_templates(active);

-- Step 3: Verify table structure
SELECT 
    column_name, 
    data_type, 
    is_nullable,
    column_default
FROM information_schema.columns 
WHERE table_name = 'whatsapp_templates'
ORDER BY ordinal_position;

-- Step 4: Show current count
SELECT COUNT(*) as template_count FROM whatsapp_templates;

