-- Step 6: Add foreign key constraints
-- Run this only after all columns are converted to bigint

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

-- Verify foreign keys were created
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
)
ORDER BY kcu.column_name;
