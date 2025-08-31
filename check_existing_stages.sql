-- Check what stage IDs are currently being used in the system
-- This will help identify which stage mappings need to be added

-- Check stages in leads table (new leads)
SELECT 
    'leads' as table_name,
    stage as stage_id,
    COUNT(*) as count
FROM leads 
WHERE stage IS NOT NULL AND stage != ''
GROUP BY stage
ORDER BY count DESC;

-- Check stages in leads_lead table (legacy leads)
SELECT 
    'leads_lead' as table_name,
    stage as stage_id,
    COUNT(*) as count
FROM leads_lead 
WHERE stage IS NOT NULL AND stage != ''
GROUP BY stage
ORDER BY count DESC;

-- Check handler_stage in leads_lead table
SELECT 
    'leads_lead (handler_stage)' as table_name,
    handler_stage as stage_id,
    COUNT(*) as count
FROM leads_lead 
WHERE handler_stage IS NOT NULL AND handler_stage != ''
GROUP BY handler_stage
ORDER BY count DESC;

-- Check what's currently in the lead_stages table
SELECT 
    'lead_stages' as table_name,
    id as stage_id,
    name as stage_name,
    'mapped' as status
FROM lead_stages
ORDER BY id;

-- Summary of unmapped stages
WITH all_stages AS (
    SELECT stage as stage_id FROM leads WHERE stage IS NOT NULL AND stage != ''
    UNION ALL
    SELECT stage as stage_id FROM leads_lead WHERE stage IS NOT NULL AND stage != ''
    UNION ALL
    SELECT handler_stage as stage_id FROM leads_lead WHERE handler_stage IS NOT NULL AND handler_stage != ''
),
mapped_stages AS (
    SELECT id as stage_id FROM lead_stages
)
SELECT 
    s.stage_id,
    COUNT(*) as usage_count,
    CASE 
        WHEN m.stage_id IS NULL THEN 'UNMAPPED'
        ELSE 'MAPPED'
    END as status
FROM all_stages s
LEFT JOIN mapped_stages m ON s.stage_id = m.stage_id
GROUP BY s.stage_id, m.stage_id
ORDER BY usage_count DESC, s.stage_id;
