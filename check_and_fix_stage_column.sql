-- Check the structure of leads_lead table to see stage-related columns
SELECT 
    column_name, 
    data_type, 
    is_nullable,
    column_default
FROM information_schema.columns 
WHERE table_name = 'leads_lead' 
  AND table_schema = 'public'
  AND column_name LIKE '%stage%'
ORDER BY ordinal_position;

-- Check if lead_stages table exists and has data
SELECT 'lead_stages table info' as info;
SELECT COUNT(*) as total_stages FROM lead_stages;
SELECT id, name FROM lead_stages LIMIT 10;

-- Check what stage values exist in leads_lead
SELECT 'Stage values in leads_lead' as info;
SELECT DISTINCT stage FROM leads_lead WHERE stage IS NOT NULL LIMIT 10;

-- Try to create the foreign key for stage
DO $$
DECLARE
    stage_column_name TEXT;
BEGIN
    -- First check if stage column exists
    IF EXISTS (
        SELECT 1 
        FROM information_schema.columns 
        WHERE table_name = 'leads_lead' 
          AND column_name = 'stage'
          AND table_schema = 'public'
    ) THEN
        RAISE NOTICE 'Stage column exists in leads_lead';
        
        -- Try to add the foreign key
        IF NOT EXISTS (
            SELECT 1 
            FROM information_schema.table_constraints 
            WHERE table_name = 'leads_lead' 
              AND constraint_name = 'fk_leads_lead_stage'
              AND table_schema = 'public'
        ) THEN
            ALTER TABLE public.leads_lead 
            ADD CONSTRAINT fk_leads_lead_stage 
            FOREIGN KEY (stage) 
            REFERENCES public.lead_stages(id);
            RAISE NOTICE 'Foreign key constraint added between leads_lead.stage and lead_stages.id';
        ELSE
            RAISE NOTICE 'Foreign key constraint already exists between leads_lead.stage and lead_stages.id';
        END IF;
    ELSE
        RAISE NOTICE 'Stage column does not exist in leads_lead table';
        
        -- Check for alternative column names
        SELECT column_name INTO stage_column_name
        FROM information_schema.columns 
        WHERE table_name = 'leads_lead' 
          AND table_schema = 'public'
          AND column_name LIKE '%stage%'
        LIMIT 1;
        
        IF stage_column_name IS NOT NULL THEN
            RAISE NOTICE 'Found stage-related column: %', stage_column_name;
        ELSE
            RAISE NOTICE 'No stage-related columns found in leads_lead table';
        END IF;
    END IF;
EXCEPTION
    WHEN OTHERS THEN
        RAISE NOTICE 'Could not create stage foreign key: %', SQLERRM;
END $$;

-- Final verification of constraints
SELECT 
    tc.constraint_name, 
    tc.table_name, 
    kcu.column_name,
    tc.constraint_type,
    ccu.table_name AS foreign_table_name,
    ccu.column_name AS foreign_column_name
FROM 
    information_schema.table_constraints AS tc 
    LEFT JOIN information_schema.key_column_usage AS kcu
      ON tc.constraint_name = kcu.constraint_name
      AND tc.table_schema = kcu.table_schema
    LEFT JOIN information_schema.constraint_column_usage AS ccu
      ON ccu.constraint_name = tc.constraint_name
      AND ccu.table_schema = tc.table_schema
WHERE tc.table_name = 'leads_lead'
  AND tc.constraint_type = 'FOREIGN KEY'
  AND kcu.column_name LIKE '%stage%'
ORDER BY tc.constraint_type, kcu.column_name;
