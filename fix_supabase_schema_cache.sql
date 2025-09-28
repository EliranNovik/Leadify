-- Fix Supabase Schema Cache and Foreign Key Issues
-- This script ensures proper foreign key relationships and refreshes schema cache

-- Step 1: Verify and recreate foreign key constraints if needed
DO $$
BEGIN
    -- Drop existing constraint if it exists (to recreate it properly)
    IF EXISTS (
        SELECT 1 FROM information_schema.table_constraints 
        WHERE constraint_name = 'leads_leadstage_lead_id_fkey' 
        AND table_name = 'leads_leadstage'
    ) THEN
        ALTER TABLE leads_leadstage DROP CONSTRAINT leads_leadstage_lead_id_fkey;
        RAISE NOTICE 'Dropped existing foreign key constraint: leads_leadstage_lead_id_fkey';
    END IF;
    
    -- Recreate the foreign key constraint
    ALTER TABLE leads_leadstage 
    ADD CONSTRAINT leads_leadstage_lead_id_fkey 
    FOREIGN KEY (lead_id) REFERENCES leads_lead(id);
    
    RAISE NOTICE 'Created foreign key constraint: leads_leadstage_lead_id_fkey';
EXCEPTION
    WHEN foreign_key_violation THEN
        RAISE NOTICE 'Foreign key constraint failed - orphaned records exist. Run cleanup first.';
    WHEN OTHERS THEN
        RAISE NOTICE 'Error creating foreign key constraint: %', SQLERRM;
END $$;

-- Step 2: Ensure proformas table has proper foreign key
DO $$
BEGIN
    -- Drop existing constraint if it exists
    IF EXISTS (
        SELECT 1 FROM information_schema.table_constraints 
        WHERE constraint_name = 'proformas_lead_id_fkey' 
        AND table_name = 'proformas'
    ) THEN
        ALTER TABLE proformas DROP CONSTRAINT proformas_lead_id_fkey;
        RAISE NOTICE 'Dropped existing foreign key constraint: proformas_lead_id_fkey';
    END IF;
    
    -- Recreate the foreign key constraint
    ALTER TABLE proformas 
    ADD CONSTRAINT proformas_lead_id_fkey 
    FOREIGN KEY (lead_id) REFERENCES leads_lead(id);
    
    RAISE NOTICE 'Created foreign key constraint: proformas_lead_id_fkey';
EXCEPTION
    WHEN foreign_key_violation THEN
        RAISE NOTICE 'Foreign key constraint failed - orphaned records exist. Run cleanup first.';
    WHEN OTHERS THEN
        RAISE NOTICE 'Error creating foreign key constraint: %', SQLERRM;
END $$;

-- Step 3: Refresh schema cache by updating table statistics
ANALYZE leads_leadstage;
ANALYZE leads_lead;
ANALYZE proformas;

-- Step 4: Verify foreign key relationships exist
DO $$
DECLARE
    fk_count INTEGER;
BEGIN
    SELECT COUNT(*) INTO fk_count
    FROM information_schema.table_constraints 
    WHERE constraint_type = 'FOREIGN KEY' 
    AND table_name IN ('leads_leadstage', 'proformas')
    AND constraint_name LIKE '%lead_id_fkey';
    
    RAISE NOTICE 'Found % foreign key constraints for lead_id', fk_count;
    
    IF fk_count >= 2 THEN
        RAISE NOTICE '✅ Foreign key relationships are properly configured';
    ELSE
        RAISE NOTICE '❌ Foreign key relationships are missing';
    END IF;
END $$;

-- Step 5: Test the relationships
DO $$
BEGIN
    -- Test leads_leadstage relationship
    BEGIN
        PERFORM 1 FROM leads_leadstage 
        JOIN leads_lead ON leads_leadstage.lead_id = leads_lead.id 
        LIMIT 1;
        RAISE NOTICE '✅ leads_leadstage JOIN test: SUCCESS';
    EXCEPTION
        WHEN OTHERS THEN
            RAISE NOTICE '❌ leads_leadstage JOIN test: FAILED - %', SQLERRM;
    END;
    
    -- Test proformas relationship
    BEGIN
        PERFORM 1 FROM proformas 
        JOIN leads_lead ON proformas.lead_id = leads_lead.id 
        LIMIT 1;
        RAISE NOTICE '✅ proformas JOIN test: SUCCESS';
    EXCEPTION
        WHEN OTHERS THEN
            RAISE NOTICE '❌ proformas JOIN test: FAILED - %', SQLERRM;
    END;
END $$;

-- Final message
DO $$
BEGIN
    RAISE NOTICE 'Schema cache refresh completed!';
    RAISE NOTICE 'If issues persist, restart your Supabase project to refresh the schema cache.';
END $$;
