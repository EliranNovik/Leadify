-- Migration script to convert role columns from text to bigint
-- This will allow proper foreign key relationships with tenants_employee table

-- Step 1: First, let's check the current data to see what needs to be cleaned
-- Run these queries to see what data we're working with:

-- Check current data types and sample values
SELECT 
    column_name, 
    data_type, 
    is_nullable
FROM information_schema.columns 
WHERE table_name = 'leads_lead' 
AND column_name IN (
    'case_handler_id', 
    'expert_id', 
    'closer_id', 
    'meeting_scheduler_id', 
    'meeting_manager_id', 
    'meeting_lawyer_id', 
    'exclusive_handler_id', 
    'anchor_id'
);

-- Check sample values to understand data format
SELECT 'case_handler_id samples:' as info;
SELECT DISTINCT case_handler_id FROM leads_lead WHERE case_handler_id IS NOT NULL AND case_handler_id != '' LIMIT 10;

SELECT 'expert_id samples:' as info;
SELECT DISTINCT expert_id FROM leads_lead WHERE expert_id IS NOT NULL AND expert_id != '' LIMIT 10;

SELECT 'closer_id samples:' as info;
SELECT DISTINCT closer_id FROM leads_lead WHERE closer_id IS NOT NULL AND closer_id != '' LIMIT 10;

SELECT 'meeting_scheduler_id samples:' as info;
SELECT DISTINCT meeting_scheduler_id FROM leads_lead WHERE meeting_scheduler_id IS NOT NULL AND meeting_scheduler_id != '' LIMIT 10;

SELECT 'meeting_manager_id samples:' as info;
SELECT DISTINCT meeting_manager_id FROM leads_lead WHERE meeting_manager_id IS NOT NULL AND meeting_manager_id != '' LIMIT 10;

-- Step 2: Clean up invalid data (non-numeric values)
-- This will set non-numeric values to NULL so they can be converted to bigint

-- Clean case_handler_id
UPDATE leads_lead 
SET case_handler_id = NULL 
WHERE case_handler_id IS NOT NULL 
AND case_handler_id != '' 
AND case_handler_id !~ '^[0-9]+$';

-- Clean expert_id
UPDATE leads_lead 
SET expert_id = NULL 
WHERE expert_id IS NOT NULL 
AND expert_id != '' 
AND expert_id !~ '^[0-9]+$';

-- Clean closer_id
UPDATE leads_lead 
SET closer_id = NULL 
WHERE closer_id IS NOT NULL 
AND closer_id != '' 
AND closer_id !~ '^[0-9]+$';

-- Clean meeting_scheduler_id
UPDATE leads_lead 
SET meeting_scheduler_id = NULL 
WHERE meeting_scheduler_id IS NOT NULL 
AND meeting_scheduler_id != '' 
AND meeting_scheduler_id !~ '^[0-9]+$';

-- Clean meeting_manager_id
UPDATE leads_lead 
SET meeting_manager_id = NULL 
WHERE meeting_manager_id IS NOT NULL 
AND meeting_manager_id != '' 
AND meeting_manager_id !~ '^[0-9]+$';

-- Clean meeting_lawyer_id
UPDATE leads_lead 
SET meeting_lawyer_id = NULL 
WHERE meeting_lawyer_id IS NOT NULL 
AND meeting_lawyer_id != '' 
AND meeting_lawyer_id !~ '^[0-9]+$';

-- Clean exclusive_handler_id
UPDATE leads_lead 
SET exclusive_handler_id = NULL 
WHERE exclusive_handler_id IS NOT NULL 
AND exclusive_handler_id != '' 
AND exclusive_handler_id !~ '^[0-9]+$';

-- Clean anchor_id
UPDATE leads_lead 
SET anchor_id = NULL 
WHERE anchor_id IS NOT NULL 
AND anchor_id != '' 
AND anchor_id !~ '^[0-9]+$';

-- Step 3: Convert columns to bigint
-- Note: This will fail if there are still non-numeric values

-- Convert case_handler_id to bigint
ALTER TABLE leads_lead 
ALTER COLUMN case_handler_id TYPE bigint 
USING case_handler_id::bigint;

-- Convert expert_id to bigint
ALTER TABLE leads_lead 
ALTER COLUMN expert_id TYPE bigint 
USING expert_id::bigint;

-- Convert closer_id to bigint
ALTER TABLE leads_lead 
ALTER COLUMN closer_id TYPE bigint 
USING closer_id::bigint;

-- Convert meeting_scheduler_id to bigint
ALTER TABLE leads_lead 
ALTER COLUMN meeting_scheduler_id TYPE bigint 
USING meeting_scheduler_id::bigint;

-- Convert meeting_manager_id to bigint
ALTER TABLE leads_lead 
ALTER COLUMN meeting_manager_id TYPE bigint 
USING meeting_manager_id::bigint;

-- Convert meeting_lawyer_id to bigint
ALTER TABLE leads_lead 
ALTER COLUMN meeting_lawyer_id TYPE bigint 
USING meeting_lawyer_id::bigint;

-- Convert exclusive_handler_id to bigint
ALTER TABLE leads_lead 
ALTER COLUMN exclusive_handler_id TYPE bigint 
USING exclusive_handler_id::bigint;

-- Convert anchor_id to bigint
ALTER TABLE leads_lead 
ALTER COLUMN anchor_id TYPE bigint 
USING anchor_id::bigint;

-- Step 4: Add foreign key constraints
-- Now that the columns are bigint, we can add proper foreign keys

-- Add foreign key for case_handler_id
ALTER TABLE leads_lead 
ADD CONSTRAINT fk_leads_lead_case_handler_id 
FOREIGN KEY (case_handler_id) REFERENCES tenants_employee(id);

-- Add foreign key for expert_id
ALTER TABLE leads_lead 
ADD CONSTRAINT fk_leads_lead_expert_id 
FOREIGN KEY (expert_id) REFERENCES tenants_employee(id);

-- Add foreign key for closer_id
ALTER TABLE leads_lead 
ADD CONSTRAINT fk_leads_lead_closer_id 
FOREIGN KEY (closer_id) REFERENCES tenants_employee(id);

-- Add foreign key for meeting_scheduler_id
ALTER TABLE leads_lead 
ADD CONSTRAINT fk_leads_lead_meeting_scheduler_id 
FOREIGN KEY (meeting_scheduler_id) REFERENCES tenants_employee(id);

-- Add foreign key for meeting_manager_id
ALTER TABLE leads_lead 
ADD CONSTRAINT fk_leads_lead_meeting_manager_id 
FOREIGN KEY (meeting_manager_id) REFERENCES tenants_employee(id);

-- Add foreign key for meeting_lawyer_id
ALTER TABLE leads_lead 
ADD CONSTRAINT fk_leads_lead_meeting_lawyer_id 
FOREIGN KEY (meeting_lawyer_id) REFERENCES tenants_employee(id);

-- Add foreign key for exclusive_handler_id
ALTER TABLE leads_lead 
ADD CONSTRAINT fk_leads_lead_exclusive_handler_id 
FOREIGN KEY (exclusive_handler_id) REFERENCES tenants_employee(id);

-- Add foreign key for anchor_id
ALTER TABLE leads_lead 
ADD CONSTRAINT fk_leads_lead_anchor_id 
FOREIGN KEY (anchor_id) REFERENCES tenants_employee(id);

-- Step 5: Create the indexes (now that columns are proper types)
-- These indexes will be much more efficient with bigint columns

-- Indexes for individual role columns
CREATE INDEX IF NOT EXISTS idx_leads_lead_case_handler_id 
ON leads_lead USING btree (case_handler_id);

CREATE INDEX IF NOT EXISTS idx_leads_lead_expert_id 
ON leads_lead USING btree (expert_id);

CREATE INDEX IF NOT EXISTS idx_leads_lead_closer_id 
ON leads_lead USING btree (closer_id);

CREATE INDEX IF NOT EXISTS idx_leads_lead_meeting_scheduler_id 
ON leads_lead USING btree (meeting_scheduler_id);

CREATE INDEX IF NOT EXISTS idx_leads_lead_meeting_manager_id 
ON leads_lead USING btree (meeting_manager_id);

CREATE INDEX IF NOT EXISTS idx_leads_lead_meeting_lawyer_id 
ON leads_lead USING btree (meeting_lawyer_id);

CREATE INDEX IF NOT EXISTS idx_leads_lead_exclusive_handler_id 
ON leads_lead USING btree (exclusive_handler_id);

CREATE INDEX IF NOT EXISTS idx_leads_lead_anchor_id 
ON leads_lead USING btree (anchor_id);

-- Composite indexes for performance
CREATE INDEX IF NOT EXISTS idx_leads_lead_case_handler_status_cdate 
ON leads_lead USING btree (case_handler_id, status, cdate DESC);

CREATE INDEX IF NOT EXISTS idx_leads_lead_expert_status_cdate 
ON leads_lead USING btree (expert_id, status, cdate DESC);

CREATE INDEX IF NOT EXISTS idx_leads_lead_closer_status_cdate 
ON leads_lead USING btree (closer_id, status, cdate DESC);

CREATE INDEX IF NOT EXISTS idx_leads_lead_scheduler_status_cdate 
ON leads_lead USING btree (meeting_scheduler_id, status, cdate DESC);

CREATE INDEX IF NOT EXISTS idx_leads_lead_manager_status_cdate 
ON leads_lead USING btree (meeting_manager_id, status, cdate DESC);

-- Step 6: Verify the changes
-- Check that the columns are now bigint
SELECT 
    column_name, 
    data_type, 
    is_nullable
FROM information_schema.columns 
WHERE table_name = 'leads_lead' 
AND column_name IN (
    'case_handler_id', 
    'expert_id', 
    'closer_id', 
    'meeting_scheduler_id', 
    'meeting_manager_id', 
    'meeting_lawyer_id', 
    'exclusive_handler_id', 
    'anchor_id'
);

-- Check that foreign keys were created
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
AND tc.table_name = 'leads_lead'
AND kcu.column_name IN (
    'case_handler_id', 
    'expert_id', 
    'closer_id', 
    'meeting_scheduler_id', 
    'meeting_manager_id', 
    'meeting_lawyer_id', 
    'exclusive_handler_id', 
    'anchor_id'
);

-- Check that indexes were created
SELECT 
    indexname, 
    indexdef 
FROM pg_indexes 
WHERE tablename = 'leads_lead' 
AND indexname LIKE '%case_handler%' 
OR indexname LIKE '%expert%' 
OR indexname LIKE '%closer%' 
OR indexname LIKE '%scheduler%' 
OR indexname LIKE '%manager%' 
OR indexname LIKE '%lawyer%' 
OR indexname LIKE '%exclusive%' 
OR indexname LIKE '%anchor%';
