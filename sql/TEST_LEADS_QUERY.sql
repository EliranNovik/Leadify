-- =============================================
-- TEST: Leads Query Step by Step
-- =============================================

-- Test 1: Basic leads count
SELECT COUNT(*) as total_leads FROM public.leads_lead;

-- Test 2: Leads with status = 0
SELECT COUNT(*) as active_leads FROM public.leads_lead WHERE status = 0;

-- Test 3: Leads with stage < 100
SELECT COUNT(*) as stage_less_100 FROM public.leads_lead WHERE stage < 100;

-- Test 4: Leads with next_followup not null
SELECT COUNT(*) as with_followup FROM public.leads_lead WHERE next_followup IS NOT NULL;

-- Test 5: Leads with date range
SELECT COUNT(*) as date_range FROM public.leads_lead 
WHERE next_followup <= '2025-09-30' 
  AND next_followup >= '2025-08-11';

-- Test 6: Leads with expert_id or meeting_manager_id = 75
SELECT COUNT(*) as user_75 FROM public.leads_lead 
WHERE expert_id = 75 OR meeting_manager_id = 75;

-- Test 7: Combined query (the failing one)
SELECT COUNT(*) as combined_test FROM public.leads_lead 
WHERE next_followup <= '2025-09-30' 
  AND next_followup >= '2025-08-11' 
  AND next_followup IS NOT NULL 
  AND status = 0 
  AND stage < 100 
  AND (expert_id = 75 OR meeting_manager_id = 75);

-- Test 8: Check if the columns exist
SELECT column_name, data_type 
FROM information_schema.columns 
WHERE table_name = 'leads_lead' 
  AND column_name IN ('next_followup', 'status', 'stage', 'expert_id', 'meeting_manager_id');
