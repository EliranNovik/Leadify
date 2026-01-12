-- Count leads in leads_lead table where stage is 100 and case_handler_id is not null
SELECT COUNT(*) as count_leads
FROM leads_lead
WHERE 
    stage = 100
    AND case_handler_id IS NOT NULL;

-- Get all leads with stage 100 and case_handler_id not null (with details)
SELECT 
    id,
    lead_number,
    name,
    stage,
    case_handler_id,
    total_base,
    total,
    currency_id,
    cdate,
    udate
FROM leads_lead
WHERE 
    stage = 100
    AND case_handler_id IS NOT NULL
ORDER BY id;

-- Get count breakdown by case_handler_id
SELECT 
    case_handler_id,
    COUNT(*) as lead_count
FROM leads_lead
WHERE 
    stage = 100
    AND case_handler_id IS NOT NULL
GROUP BY case_handler_id
ORDER BY lead_count DESC;

-- Get leads with case handler details (join with tenants_employee if needed)
SELECT 
    ll.id,
    ll.lead_number,
    ll.name,
    ll.stage,
    ll.case_handler_id,
    te.display_name as case_handler_name,
    ll.total_base,
    ll.total,
    ll.currency_id
FROM leads_lead ll
LEFT JOIN tenants_employee te ON ll.case_handler_id = te.id
WHERE 
    ll.stage = 100
    AND ll.case_handler_id IS NOT NULL
ORDER BY ll.id;
