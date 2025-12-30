-- Preview query to see what leads will be migrated from leads_lead_src to leads_lead
-- This shows leads that exist in leads_lead_src but NOT in leads_lead

-- Count of leads to be migrated
SELECT 
    COUNT(*) as total_leads_to_migrate
FROM leads_lead_src src
LEFT JOIN leads_lead dest ON src.id::bigint = dest.id
WHERE dest.id IS NULL
  AND src.id IS NOT NULL 
  AND src.id != ''
  AND src.id ~ '^[0-9]+$';

-- Detailed preview of leads that will be migrated (first 50)
SELECT 
    src.id,
    src.name,
    src.email,
    src.phone,
    src.mobile,
    src.topic,
    src.cdate,
    src.stage,
    src.status,
    src.source_id,
    src.case_handler_id,
    src.meeting_scheduler_id,
    src.meeting_manager_id,
    src.meeting_lawyer_id,
    src.closer_id,
    src.expert_id,
    CASE 
        WHEN dest.id IS NOT NULL THEN 'EXISTS' 
        ELSE 'WILL MIGRATE'
    END as migration_status
FROM leads_lead_src src
LEFT JOIN leads_lead dest ON src.id::bigint = dest.id
WHERE dest.id IS NULL
  AND src.id IS NOT NULL 
  AND src.id != ''
  AND src.id ~ '^[0-9]+$'
ORDER BY src.id::bigint
LIMIT 50;

-- Summary by topic/category
SELECT 
    src.topic,
    COUNT(*) as count_to_migrate
FROM leads_lead_src src
LEFT JOIN leads_lead dest ON src.id::bigint = dest.id
WHERE dest.id IS NULL
  AND src.id IS NOT NULL 
  AND src.id != ''
  AND src.id ~ '^[0-9]+$'
GROUP BY src.topic
ORDER BY count_to_migrate DESC;

-- Check for any problematic IDs (non-numeric or empty)
SELECT 
    'Invalid IDs in source (will be skipped)' as issue_type,
    COUNT(*) as count
FROM leads_lead_src
WHERE id IS NULL 
   OR id = ''
   OR id !~ '^[0-9]+$'
UNION ALL
SELECT 
    'Valid IDs that will be migrated' as issue_type,
    COUNT(*) as count
FROM leads_lead_src src
LEFT JOIN leads_lead dest ON src.id::bigint = dest.id
WHERE dest.id IS NULL
  AND src.id IS NOT NULL 
  AND src.id != ''
  AND src.id ~ '^[0-9]+$';

