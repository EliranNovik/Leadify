-- Add missing indexes for role columns in leads_lead table
-- These indexes are crucial for performance when filtering by employee roles

-- 1. Add index for case_handler_id (currently missing)
CREATE INDEX IF NOT EXISTS idx_leads_lead_case_handler_id 
ON public.leads_lead USING btree (case_handler_id);

-- 2. Add composite index for case_handler_id with cdate (for MyCases page)
CREATE INDEX IF NOT EXISTS idx_leads_lead_case_handler_id_cdate 
ON public.leads_lead USING btree (case_handler_id, cdate DESC);

-- 3. Add index for expert_id (currently missing)
CREATE INDEX IF NOT EXISTS idx_leads_lead_expert_id 
ON public.leads_lead USING btree (expert_id);

-- 4. Add composite index for expert_id with cdate
CREATE INDEX IF NOT EXISTS idx_leads_lead_expert_id_cdate 
ON public.leads_lead USING btree (expert_id, cdate DESC);

-- 5. Add index for meeting_manager_id (currently missing)
CREATE INDEX IF NOT EXISTS idx_leads_lead_meeting_manager_id 
ON public.leads_lead USING btree (meeting_manager_id);

-- 6. Add composite index for meeting_manager_id with cdate
CREATE INDEX IF NOT EXISTS idx_leads_lead_meeting_manager_id_cdate 
ON public.leads_lead USING btree (meeting_manager_id, cdate DESC);

-- 7. Add index for meeting_lawyer_id (currently missing)
CREATE INDEX IF NOT EXISTS idx_leads_lead_meeting_lawyer_id 
ON public.leads_lead USING btree (meeting_lawyer_id);

-- 8. Add composite index for meeting_lawyer_id with cdate
CREATE INDEX IF NOT EXISTS idx_leads_lead_meeting_lawyer_id_cdate 
ON public.leads_lead USING btree (meeting_lawyer_id, cdate DESC);

-- 9. Add index for exclusive_handler_id (currently missing)
CREATE INDEX IF NOT EXISTS idx_leads_lead_exclusive_handler_id 
ON public.leads_lead USING btree (exclusive_handler_id);

-- 10. Add composite index for exclusive_handler_id with cdate
CREATE INDEX IF NOT EXISTS idx_leads_lead_exclusive_handler_id_cdate 
ON public.leads_lead USING btree (exclusive_handler_id, cdate DESC);

-- 11. Add index for anchor_id (currently missing)
CREATE INDEX IF NOT EXISTS idx_leads_lead_anchor_id 
ON public.leads_lead USING btree (anchor_id);

-- 12. Add composite index for anchor_id with cdate
CREATE INDEX IF NOT EXISTS idx_leads_lead_anchor_id_cdate 
ON public.leads_lead USING btree (anchor_id, cdate DESC);

-- 13. Add index for status column (for filtering active leads)
CREATE INDEX IF NOT EXISTS idx_leads_lead_status 
ON public.leads_lead USING btree (status);

-- 14. Add composite index for status and cdate (for active leads with date range)
CREATE INDEX IF NOT EXISTS idx_leads_lead_status_cdate 
ON public.leads_lead USING btree (status, cdate DESC);

-- 15. Add composite index for case_handler_id, status, and cdate (optimal for MyCases page)
CREATE INDEX IF NOT EXISTS idx_leads_lead_case_handler_status_cdate 
ON public.leads_lead USING btree (case_handler_id, status, cdate DESC);

-- Add foreign key constraints to tenants_employee table
-- Note: These will only work if the role columns store the actual employee IDs as integers
-- If they store display names as text, we'll need to handle that differently

-- 16. Add foreign key for case_handler_id (if it stores employee IDs)
-- ALTER TABLE public.leads_lead 
-- ADD CONSTRAINT fk_leads_lead_case_handler_id 
-- FOREIGN KEY (case_handler_id) REFERENCES tenants_employee(id);

-- 17. Add foreign key for expert_id (if it stores employee IDs)
-- ALTER TABLE public.leads_lead 
-- ADD CONSTRAINT fk_leads_lead_expert_id 
-- FOREIGN KEY (expert_id) REFERENCES tenants_employee(id);

-- 18. Add foreign key for closer_id (if it stores employee IDs)
-- ALTER TABLE public.leads_lead 
-- ADD CONSTRAINT fk_leads_lead_closer_id 
-- FOREIGN KEY (closer_id) REFERENCES tenants_employee(id);

-- 19. Add foreign key for meeting_scheduler_id (if it stores employee IDs)
-- ALTER TABLE public.leads_lead 
-- ADD CONSTRAINT fk_leads_lead_meeting_scheduler_id 
-- FOREIGN KEY (meeting_scheduler_id) REFERENCES tenants_employee(id);

-- 20. Add foreign key for meeting_manager_id (if it stores employee IDs)
-- ALTER TABLE public.leads_lead 
-- ADD CONSTRAINT fk_leads_lead_meeting_manager_id 
-- FOREIGN KEY (meeting_manager_id) REFERENCES tenants_employee(id);

-- 21. Add foreign key for meeting_lawyer_id (if it stores employee IDs)
-- ALTER TABLE public.leads_lead 
-- ADD CONSTRAINT fk_leads_lead_meeting_lawyer_id 
-- FOREIGN KEY (meeting_lawyer_id) REFERENCES tenants_employee(id);

-- 22. Add foreign key for exclusive_handler_id (if it stores employee IDs)
-- ALTER TABLE public.leads_lead 
-- ADD CONSTRAINT fk_leads_lead_exclusive_handler_id 
-- FOREIGN KEY (exclusive_handler_id) REFERENCES tenants_employee(id);

-- 23. Add foreign key for anchor_id (if it stores employee IDs)
-- ALTER TABLE public.leads_lead 
-- ADD CONSTRAINT fk_leads_lead_anchor_id 
-- FOREIGN KEY (anchor_id) REFERENCES tenants_employee(id);

-- Note: The foreign key constraints are commented out because:
-- 1. We need to verify the data types and values in these columns first
-- 2. Some columns might store display names (text) instead of IDs (integers)
-- 3. Adding foreign keys on existing data might fail if there are invalid references

-- To enable foreign keys, first run:
-- SELECT DISTINCT case_handler_id FROM leads_lead WHERE case_handler_id IS NOT NULL LIMIT 10;
-- SELECT DISTINCT expert_id FROM leads_lead WHERE expert_id IS NOT NULL LIMIT 10;
-- etc.

-- Then uncomment and run the appropriate foreign key constraints based on the data format.
