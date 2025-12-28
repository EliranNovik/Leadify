-- Add foreign key relation from call_logs to leads_leadinteractions
-- This allows call_logs to reference leads_leadinteractions if needed

-- Check if call_logs has a lead_interaction_id column and add foreign key
-- Note: Adjust column name if it's different in your schema

-- Option 1: If call_logs has a lead_interaction_id column that should reference leads_leadinteractions.id
DO $$
BEGIN
    -- Check if column exists and add foreign key if it does
    IF EXISTS (
        SELECT 1 
        FROM information_schema.columns 
        WHERE table_schema = 'public' 
        AND table_name = 'call_logs' 
        AND column_name = 'lead_interaction_id'
    ) THEN
        -- Drop existing constraint if it exists
        ALTER TABLE public.call_logs 
        DROP CONSTRAINT IF EXISTS call_logs_lead_interaction_id_fkey;
        
        -- Add foreign key constraint
        ALTER TABLE public.call_logs 
        ADD CONSTRAINT call_logs_lead_interaction_id_fkey 
        FOREIGN KEY (lead_interaction_id) 
        REFERENCES public.leads_leadinteractions(id) 
        ON DELETE SET NULL 
        ON UPDATE CASCADE;
        
        RAISE NOTICE 'Added foreign key constraint call_logs_lead_interaction_id_fkey';
    ELSE
        RAISE NOTICE 'Column lead_interaction_id does not exist in call_logs table';
    END IF;
END $$;

-- Option 2: If you want to add a relation where leads_leadinteractions references call_logs
-- (for example, if calls from call_logs should link to interactions in leads_leadinteractions)
-- Uncomment the following if this is what you need:

-- DO $$
-- BEGIN
--     IF EXISTS (
--         SELECT 1 
--         FROM information_schema.columns 
--         WHERE table_schema = 'public' 
--         AND table_name = 'leads_leadinteractions' 
--         AND column_name = 'call_log_id'
--     ) THEN
--         ALTER TABLE public.leads_leadinteractions 
--         DROP CONSTRAINT IF EXISTS leads_leadinteractions_call_log_id_fkey;
--         
--         ALTER TABLE public.leads_leadinteractions 
--         ADD CONSTRAINT leads_leadinteractions_call_log_id_fkey 
--         FOREIGN KEY (call_log_id) 
--         REFERENCES public.call_logs(id) 
--         ON DELETE SET NULL 
--         ON UPDATE CASCADE;
--         
--         RAISE NOTICE 'Added foreign key constraint leads_leadinteractions_call_log_id_fkey';
--     ELSE
--         RAISE NOTICE 'Column call_log_id does not exist in leads_leadinteractions table';
--     END IF;
-- END $$;

-- Verify the constraint was created
SELECT 
    tc.constraint_name, 
    tc.table_name, 
    kcu.column_name, 
    ccu.table_name AS foreign_table_name,
    ccu.column_name AS foreign_column_name 
FROM 
    information_schema.table_constraints AS tc 
    JOIN information_schema.key_column_usage AS kcu
      ON tc.constraint_name = kcu.constraint_name
      AND tc.table_schema = kcu.table_schema
    JOIN information_schema.constraint_column_usage AS ccu
      ON ccu.constraint_name = tc.constraint_name
      AND ccu.table_schema = tc.table_schema
WHERE tc.constraint_type = 'FOREIGN KEY' 
  AND (
    (tc.table_name = 'call_logs' AND ccu.table_name = 'leads_leadinteractions')
    OR (tc.table_name = 'leads_leadinteractions' AND ccu.table_name = 'call_logs')
  );

