-- Diagnostic query to check why stage transitions aren't working
-- Run this for a specific lead to see what interactions exist
-- 
-- INSTRUCTIONS: Replace the lead ID values in each query with your actual lead ID
-- For legacy leads: use numeric ID (e.g., 12345)
-- For new leads: use UUID (e.g., 'ca220714-bf2b-40f6-8c08-0c75a228530e')

-- ============================================
-- FOR LEGACY LEADS (replace 12345 with your legacy lead ID)
-- ============================================

-- Check emails
SELECT 
    'emails' as source,
    direction,
    COUNT(*) as count,
    COUNT(*) FILTER (WHERE direction = 'outgoing') as outbound_count,
    COUNT(*) FILTER (WHERE direction = 'incoming') as inbound_count
FROM emails
WHERE legacy_id = 12345  -- Replace with your legacy lead ID
GROUP BY direction;

-- Check WhatsApp messages
SELECT 
    'whatsapp_messages' as source,
    direction,
    COUNT(*) as count,
    COUNT(*) FILTER (WHERE direction = 'out') as outbound_count,
    COUNT(*) FILTER (WHERE direction = 'in') as inbound_count
FROM whatsapp_messages
WHERE legacy_id = 12345  -- Replace with your legacy lead ID
GROUP BY direction;

-- Check call_logs (legacy only)
SELECT 
    'call_logs' as source,
    direction,
    COUNT(*) as count,
    COUNT(*) FILTER (WHERE duration > 120) as calls_over_2min,
    COUNT(*) FILTER (WHERE direction ILIKE '%outgoing%' OR direction = 'out') as outbound_count,
    COUNT(*) FILTER (WHERE direction ILIKE '%incoming%' OR direction = 'in') as inbound_count
FROM call_logs
WHERE lead_id::BIGINT = 12345  -- Replace with your legacy lead ID
GROUP BY direction;

-- Check leads_leadinteractions (legacy only)
SELECT 
    'leads_leadinteractions' as source,
    direction,
    kind,
    COUNT(*) as count,
    COUNT(*) FILTER (WHERE kind = 'c' AND minutes > 2) as calls_over_2min,
    COUNT(*) FILTER (WHERE direction = 'o') as outbound_count,
    COUNT(*) FILTER (WHERE direction = 'i') as inbound_count
FROM leads_leadinteractions
WHERE lead_id = 12345  -- Replace with your legacy lead ID
GROUP BY direction, kind;

-- Check current stage
SELECT 
    'leads_lead' as table_name,
    stage,
    id
FROM leads_lead
WHERE id = 12345;  -- Replace with your legacy lead ID

-- Test the function directly
SELECT evaluate_and_update_stage('12345', true) as result_stage;  -- Replace '12345' with your legacy lead ID

-- ============================================
-- FOR NEW LEADS (replace 'uuid-here' with your new lead UUID)
-- ============================================

-- Check emails
-- SELECT 
--     'emails' as source,
--     direction,
--     COUNT(*) as count,
--     COUNT(*) FILTER (WHERE direction = 'outgoing') as outbound_count,
--     COUNT(*) FILTER (WHERE direction = 'incoming') as inbound_count
-- FROM emails
-- WHERE client_id = 'uuid-here'::UUID  -- Replace with your new lead UUID
-- GROUP BY direction;

-- Check WhatsApp messages
-- SELECT 
--     'whatsapp_messages' as source,
--     direction,
--     COUNT(*) as count,
--     COUNT(*) FILTER (WHERE direction = 'out') as outbound_count,
--     COUNT(*) FILTER (WHERE direction = 'in') as inbound_count
-- FROM whatsapp_messages
-- WHERE lead_id = 'uuid-here'::UUID  -- Replace with your new lead UUID
-- GROUP BY direction;

-- Check current stage
-- SELECT 
--     'leads' as table_name,
--     stage,
--     id
-- FROM leads
-- WHERE id = 'uuid-here'::UUID;  -- Replace with your new lead UUID

-- Test the function directly
-- SELECT evaluate_and_update_stage('uuid-here', false) as result_stage;  -- Replace 'uuid-here' with your new lead UUID

-- ============================================
-- SUMMARY QUERY (for legacy leads - replace 12345)
-- ============================================
-- This query shows a summary of all interactions for a lead
SELECT 
    'SUMMARY' as query_type,
    COUNT(DISTINCT CASE WHEN e.direction = 'outgoing' THEN e.id END) as email_outbound,
    COUNT(DISTINCT CASE WHEN e.direction = 'incoming' THEN e.id END) as email_inbound,
    COUNT(DISTINCT CASE WHEN w.direction = 'out' THEN w.id END) as whatsapp_outbound,
    COUNT(DISTINCT CASE WHEN w.direction = 'in' THEN w.id END) as whatsapp_inbound,
    COUNT(DISTINCT CASE WHEN c.duration > 120 THEN c.id END) as calls_over_2min,
    COUNT(DISTINCT CASE WHEN li.direction = 'o' THEN li.id END) as legacy_interaction_outbound,
    COUNT(DISTINCT CASE WHEN li.direction = 'i' THEN li.id END) as legacy_interaction_inbound,
    COUNT(DISTINCT CASE WHEN li.kind = 'c' AND li.minutes > 2 THEN li.id END) as legacy_calls_over_2min
FROM leads_lead ll
LEFT JOIN emails e ON e.legacy_id = ll.id
LEFT JOIN whatsapp_messages w ON w.legacy_id = ll.id
LEFT JOIN call_logs c ON c.lead_id::BIGINT = ll.id
LEFT JOIN leads_leadinteractions li ON li.lead_id = ll.id
WHERE ll.id = 12345;  -- Replace with your legacy lead ID
