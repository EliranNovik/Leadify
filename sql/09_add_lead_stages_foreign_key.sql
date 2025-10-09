-- Step 9: Add foreign key relationship between leads_lead and lead_stages
-- This is needed for the MyCasesPage JOINs to work

-- First, let's check if there's already a foreign key
SELECT 
    conname as constraint_name,
    contype as constraint_type,
    pg_get_constraintdef(oid) as constraint_definition
FROM pg_constraint 
WHERE conrelid = 'leads_lead'::regclass 
AND contype = 'f'
AND pg_get_constraintdef(oid) LIKE '%lead_stages%';

-- Check if the stage column in leads_lead matches the id column in lead_stages
SELECT 
    'leads_lead.stage' as column_info,
    data_type,
    is_nullable,
    column_default
FROM information_schema.columns 
WHERE table_name = 'leads_lead' 
AND column_name = 'stage'

UNION ALL

SELECT 
    'lead_stages.id' as column_info,
    data_type,
    is_nullable,
    column_default
FROM information_schema.columns 
WHERE table_name = 'lead_stages' 
AND column_name = 'id';

-- Sample data to check compatibility
SELECT 'Sample leads_lead.stage values' as info, DISTINCT stage FROM leads_lead WHERE stage IS NOT NULL LIMIT 10;
SELECT 'Sample lead_stages.id values' as info, DISTINCT id FROM lead_stages WHERE id IS NOT NULL LIMIT 10;

-- Add the foreign key constraint
-- Note: This will only work if the data types are compatible
ALTER TABLE leads_lead 
ADD CONSTRAINT fk_leads_lead_stage 
FOREIGN KEY (stage) REFERENCES lead_stages(id);

-- Verify the constraint was added
SELECT 
    conname as constraint_name,
    contype as constraint_type,
    pg_get_constraintdef(oid) as constraint_definition
FROM pg_constraint 
WHERE conrelid = 'leads_lead'::regclass 
AND contype = 'f'
AND conname = 'fk_leads_lead_stage';
