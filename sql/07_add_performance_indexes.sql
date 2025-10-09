-- Step 7: Add performance indexes
-- Run this after foreign keys are created

-- Individual indexes for each role column
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

-- Composite indexes for common query patterns
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

-- Verify indexes were created
SELECT 
    indexname, 
    indexdef 
FROM pg_indexes 
WHERE tablename = 'leads_lead' 
AND (indexname LIKE '%case_handler%' 
     OR indexname LIKE '%expert%' 
     OR indexname LIKE '%closer%' 
     OR indexname LIKE '%scheduler%' 
     OR indexname LIKE '%manager%' 
     OR indexname LIKE '%lawyer%' 
     OR indexname LIKE '%exclusive%' 
     OR indexname LIKE '%anchor%')
ORDER BY indexname;
