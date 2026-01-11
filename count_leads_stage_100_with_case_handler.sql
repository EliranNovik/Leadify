/* Step 1: Count rows in leads_lead where stage is 100 and case_handler_id is not NULL */
SELECT 
    COUNT(*) as total_rows,
    COUNT(DISTINCT case_handler_id) as unique_case_handlers
FROM leads_lead
WHERE stage = 100
  AND case_handler_id IS NOT NULL;

/* Step 2: Update stage to 105 for leads where stage is 100 and case_handler_id is not NULL */
UPDATE leads_lead
SET stage = 105
WHERE stage = 100
  AND case_handler_id IS NOT NULL;

/* Step 3: Verify the update - count remaining rows with stage = 100 and case_handler_id is not NULL */
SELECT 
    COUNT(*) as remaining_rows_with_stage_100
FROM leads_lead
WHERE stage = 100
  AND case_handler_id IS NOT NULL;

/* Step 4: Verify the update - count rows with stage = 105 and case_handler_id is not NULL */
SELECT 
    COUNT(*) as rows_with_stage_105
FROM leads_lead
WHERE stage = 105
  AND case_handler_id IS NOT NULL;
