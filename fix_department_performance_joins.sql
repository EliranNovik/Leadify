-- Fix Department Performance Dashboard JOIN Issues
-- This script fixes the foreign key relationships needed for the department performance dashboard

-- 1. Clean up orphaned records and add foreign key constraint for leads_leadstage.lead_id -> leads_lead.id
DO $$
DECLARE
    orphaned_count INTEGER;
    total_records INTEGER;
BEGIN
    -- First, let's check if the constraint already exists
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.table_constraints 
        WHERE constraint_name = 'leads_leadstage_lead_id_fkey' 
        AND table_name = 'leads_leadstage'
    ) THEN
        -- Count total records in leads_leadstage
        SELECT COUNT(*) INTO total_records FROM leads_leadstage;
        RAISE NOTICE 'Total records in leads_leadstage: %', total_records;
        
        -- Count orphaned records (lead_id that don't exist in leads_lead)
        SELECT COUNT(*) INTO orphaned_count 
        FROM leads_leadstage 
        WHERE lead_id IS NOT NULL 
        AND lead_id NOT IN (SELECT id FROM leads_lead WHERE id IS NOT NULL);
        
        RAISE NOTICE 'Orphaned records found: %', orphaned_count;
        
        -- If there are orphaned records, we need to handle them
        IF orphaned_count > 0 THEN
            RAISE NOTICE 'Cleaning up orphaned records...';
            
            -- Option 1: Delete orphaned records (recommended for data integrity)
            DELETE FROM leads_leadstage 
            WHERE lead_id IS NOT NULL 
            AND lead_id NOT IN (SELECT id FROM leads_lead WHERE id IS NOT NULL);
            
            RAISE NOTICE 'Deleted % orphaned records from leads_leadstage', orphaned_count;
            
            -- Option 2: Set orphaned lead_id to NULL (alternative approach)
            -- UPDATE leads_leadstage 
            -- SET lead_id = NULL 
            -- WHERE lead_id IS NOT NULL 
            -- AND lead_id NOT IN (SELECT id FROM leads_lead WHERE id IS NOT NULL);
        END IF;
        
        -- Now add the foreign key constraint
        ALTER TABLE leads_leadstage 
        ADD CONSTRAINT leads_leadstage_lead_id_fkey 
        FOREIGN KEY (lead_id) REFERENCES leads_lead(id);
        
        RAISE NOTICE 'Added foreign key constraint: leads_leadstage_lead_id_fkey';
    ELSE
        RAISE NOTICE 'Foreign key constraint already exists: leads_leadstage_lead_id_fkey';
    END IF;
END $$;

-- 2. Check if proformainvoice table exists, if not create it or modify proformas
-- First, let's see what we have
DO $$
BEGIN
    -- Check if proformainvoice table exists
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'proformainvoice') THEN
        RAISE NOTICE 'proformainvoice table already exists';
    ELSE
        -- Check if proformas table exists and has the right structure
        IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'proformas') THEN
            -- Check if proformas has lead_id column
            IF NOT EXISTS (
                SELECT 1 FROM information_schema.columns 
                WHERE table_name = 'proformas' AND column_name = 'lead_id'
            ) THEN
                -- Add lead_id column to proformas table
                ALTER TABLE proformas ADD COLUMN lead_id BIGINT;
                RAISE NOTICE 'Added lead_id column to proformas table';
            ELSE
                RAISE NOTICE 'proformas table already has lead_id column';
            END IF;
            
            -- Check for orphaned records in proformas before adding constraint
            DECLARE
                proformas_orphaned_count INTEGER;
            BEGIN
                SELECT COUNT(*) INTO proformas_orphaned_count 
                FROM proformas 
                WHERE lead_id IS NOT NULL 
                AND lead_id NOT IN (SELECT id FROM leads_lead WHERE id IS NOT NULL);
                
                IF proformas_orphaned_count > 0 THEN
                    RAISE NOTICE 'Found % orphaned records in proformas, cleaning up...', proformas_orphaned_count;
                    DELETE FROM proformas 
                    WHERE lead_id IS NOT NULL 
                    AND lead_id NOT IN (SELECT id FROM leads_lead WHERE id IS NOT NULL);
                    RAISE NOTICE 'Deleted % orphaned records from proformas', proformas_orphaned_count;
                END IF;
            END;
            
            -- Add foreign key constraint (only if it doesn't exist)
            IF NOT EXISTS (
                SELECT 1 FROM information_schema.table_constraints 
                WHERE constraint_name = 'proformas_lead_id_fkey' 
                AND table_name = 'proformas'
            ) THEN
                ALTER TABLE proformas 
                ADD CONSTRAINT proformas_lead_id_fkey 
                FOREIGN KEY (lead_id) REFERENCES leads_lead(id);
                RAISE NOTICE 'Added foreign key constraint: proformas_lead_id_fkey';
            ELSE
                RAISE NOTICE 'Foreign key constraint proformas_lead_id_fkey already exists';
            END IF;
            
            -- Check if proformas has total column
            IF NOT EXISTS (
                SELECT 1 FROM information_schema.columns 
                WHERE table_name = 'proformas' AND column_name = 'total'
            ) THEN
                ALTER TABLE proformas ADD COLUMN total NUMERIC;
                RAISE NOTICE 'Added total column to proformas table';
            ELSE
                RAISE NOTICE 'proformas table already has total column';
            END IF;
            
            -- Check if proformas has cdate column
            IF NOT EXISTS (
                SELECT 1 FROM information_schema.columns 
                WHERE table_name = 'proformas' AND column_name = 'cdate'
            ) THEN
                ALTER TABLE proformas ADD COLUMN cdate TIMESTAMP WITH TIME ZONE DEFAULT NOW();
                RAISE NOTICE 'Added cdate column to proformas table';
            ELSE
                RAISE NOTICE 'proformas table already has cdate column';
            END IF;
        ELSE
            -- Create proformainvoice table with proper structure
            CREATE TABLE proformainvoice (
                id BIGINT PRIMARY KEY,
                lead_id BIGINT NOT NULL,
                total NUMERIC,
                cdate TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
                created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
                updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
                CONSTRAINT proformainvoice_lead_id_fkey 
                FOREIGN KEY (lead_id) REFERENCES leads_lead(id)
            );
            RAISE NOTICE 'Created proformainvoice table with proper structure';
        END IF;
    END IF;
END $$;

-- 3. Create indexes for better performance
CREATE INDEX IF NOT EXISTS idx_leads_leadstage_lead_id ON leads_leadstage(lead_id);
CREATE INDEX IF NOT EXISTS idx_leads_leadstage_stage ON leads_leadstage(stage);
CREATE INDEX IF NOT EXISTS idx_leads_leadstage_date ON leads_leadstage(date);

-- If we're using proformas table, add indexes there too
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'proformas') THEN
        CREATE INDEX IF NOT EXISTS idx_proformas_lead_id ON proformas(lead_id);
        CREATE INDEX IF NOT EXISTS idx_proformas_cdate ON proformas(cdate);
        RAISE NOTICE 'Added indexes to proformas table';
    END IF;
    
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'proformainvoice') THEN
        CREATE INDEX IF NOT EXISTS idx_proformainvoice_lead_id ON proformainvoice(lead_id);
        CREATE INDEX IF NOT EXISTS idx_proformainvoice_cdate ON proformainvoice(cdate);
        RAISE NOTICE 'Added indexes to proformainvoice table';
    END IF;
END $$;

-- 4. Verify the relationships work
DO $$
DECLARE
    leads_leadstage_count INTEGER;
    proformas_count INTEGER;
    proformainvoice_count INTEGER;
BEGIN
    -- Check leads_leadstage
    SELECT COUNT(*) INTO leads_leadstage_count FROM leads_leadstage;
    RAISE NOTICE 'leads_leadstage table has % records', leads_leadstage_count;
    
    -- Check proformas
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'proformas') THEN
        SELECT COUNT(*) INTO proformas_count FROM proformas;
        RAISE NOTICE 'proformas table has % records', proformas_count;
    END IF;
    
    -- Check proformainvoice
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'proformainvoice') THEN
        SELECT COUNT(*) INTO proformainvoice_count FROM proformainvoice;
        RAISE NOTICE 'proformainvoice table has % records', proformainvoice_count;
    END IF;
END $$;

-- 5. Test the JOIN queries that the dashboard will use
DO $$
BEGIN
    -- Test leads_leadstage JOIN
    BEGIN
        PERFORM 1 FROM leads_leadstage 
        JOIN leads_lead ON leads_leadstage.lead_id = leads_lead.id 
        LIMIT 1;
        RAISE NOTICE 'leads_leadstage JOIN test: SUCCESS';
    EXCEPTION
        WHEN OTHERS THEN
            RAISE NOTICE 'leads_leadstage JOIN test: FAILED - %', SQLERRM;
    END;
    
    -- Test proformas JOIN (if table exists)
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'proformas') THEN
        BEGIN
            PERFORM 1 FROM proformas 
            JOIN leads_lead ON proformas.lead_id = leads_lead.id 
            LIMIT 1;
            RAISE NOTICE 'proformas JOIN test: SUCCESS';
        EXCEPTION
            WHEN OTHERS THEN
                RAISE NOTICE 'proformas JOIN test: FAILED - %', SQLERRM;
        END;
    END IF;
    
    -- Test proformainvoice JOIN (if table exists)
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'proformainvoice') THEN
        BEGIN
            PERFORM 1 FROM proformainvoice 
            JOIN leads_lead ON proformainvoice.lead_id = leads_lead.id 
            LIMIT 1;
            RAISE NOTICE 'proformainvoice JOIN test: SUCCESS';
        EXCEPTION
            WHEN OTHERS THEN
                RAISE NOTICE 'proformainvoice JOIN test: FAILED - %', SQLERRM;
        END;
    END IF;
END $$;

-- Final completion message
DO $$
BEGIN
    RAISE NOTICE 'Department Performance Dashboard JOIN fixes completed!';
END $$;
