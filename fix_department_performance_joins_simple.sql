-- Simplified Department Performance Dashboard JOIN Fixes
-- This script fixes the foreign key relationships needed for the department performance dashboard

-- Step 1: Add foreign key constraint for leads_leadstage (skip orphaned cleanup for now)
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.table_constraints 
        WHERE constraint_name = 'leads_leadstage_lead_id_fkey' 
        AND table_name = 'leads_leadstage'
    ) THEN
        -- Add the foreign key constraint (PostgreSQL will handle orphaned records)
        ALTER TABLE leads_leadstage 
        ADD CONSTRAINT leads_leadstage_lead_id_fkey 
        FOREIGN KEY (lead_id) REFERENCES leads_lead(id);
        
        RAISE NOTICE 'Added foreign key constraint: leads_leadstage_lead_id_fkey';
    ELSE
        RAISE NOTICE 'Foreign key constraint already exists: leads_leadstage_lead_id_fkey';
    END IF;
EXCEPTION
    WHEN foreign_key_violation THEN
        RAISE NOTICE 'Foreign key constraint failed - orphaned records exist. Run cleanup first.';
END $$;

-- Step 2: Handle proformas table structure
DO $$
BEGIN
    -- Check if proformas table exists
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'proformas') THEN
        -- Add missing columns if they don't exist
        IF NOT EXISTS (
            SELECT 1 FROM information_schema.columns 
            WHERE table_name = 'proformas' AND column_name = 'lead_id'
        ) THEN
            ALTER TABLE proformas ADD COLUMN lead_id BIGINT;
        END IF;
        
        IF NOT EXISTS (
            SELECT 1 FROM information_schema.columns 
            WHERE table_name = 'proformas' AND column_name = 'total'
        ) THEN
            ALTER TABLE proformas ADD COLUMN total NUMERIC;
        END IF;
        
        IF NOT EXISTS (
            SELECT 1 FROM information_schema.columns 
            WHERE table_name = 'proformas' AND column_name = 'cdate'
        ) THEN
            ALTER TABLE proformas ADD COLUMN cdate TIMESTAMP WITH TIME ZONE DEFAULT NOW();
        END IF;
        
        -- Add foreign key constraint if it doesn't exist
        IF NOT EXISTS (
            SELECT 1 FROM information_schema.table_constraints 
            WHERE constraint_name = 'proformas_lead_id_fkey' 
            AND table_name = 'proformas'
        ) THEN
            ALTER TABLE proformas 
            ADD CONSTRAINT proformas_lead_id_fkey 
            FOREIGN KEY (lead_id) REFERENCES leads_lead(id);
        END IF;
        
        RAISE NOTICE 'Updated proformas table structure';
    ELSE
        -- Create proformainvoice table if proformas doesn't exist
        CREATE TABLE IF NOT EXISTS proformainvoice (
            id BIGINT PRIMARY KEY,
            lead_id BIGINT NOT NULL,
            total NUMERIC,
            cdate TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
            created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
            updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
            CONSTRAINT proformainvoice_lead_id_fkey 
            FOREIGN KEY (lead_id) REFERENCES leads_lead(id)
        );
        RAISE NOTICE 'Created proformainvoice table';
    END IF;
EXCEPTION
    WHEN foreign_key_violation THEN
        RAISE NOTICE 'Foreign key constraint failed - orphaned records exist. Run cleanup first.';
END $$;

-- Step 3: Create essential indexes
CREATE INDEX IF NOT EXISTS idx_leads_leadstage_lead_id ON leads_leadstage(lead_id);
CREATE INDEX IF NOT EXISTS idx_leads_leadstage_stage ON leads_leadstage(stage);
CREATE INDEX IF NOT EXISTS idx_leads_leadstage_date ON leads_leadstage(date);

-- Add indexes to proformas if it exists
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'proformas') THEN
        CREATE INDEX IF NOT EXISTS idx_proformas_lead_id ON proformas(lead_id);
        CREATE INDEX IF NOT EXISTS idx_proformas_cdate ON proformas(cdate);
    END IF;
    
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'proformainvoice') THEN
        CREATE INDEX IF NOT EXISTS idx_proformainvoice_lead_id ON proformainvoice(lead_id);
        CREATE INDEX IF NOT EXISTS idx_proformainvoice_cdate ON proformainvoice(cdate);
    END IF;
END $$;

-- Step 4: Simple verification (no expensive COUNT queries)
DO $$
BEGIN
    RAISE NOTICE 'Department Performance Dashboard JOIN fixes completed!';
    RAISE NOTICE 'Run the following queries to verify:';
    RAISE NOTICE 'SELECT COUNT(*) FROM leads_leadstage;';
    RAISE NOTICE 'SELECT COUNT(*) FROM proformas; -- if exists';
    RAISE NOTICE 'SELECT COUNT(*) FROM proformainvoice; -- if exists';
END $$;
