-- Check if leads_lead.id is actually bigint and what its sequence type is

-- Check the column type
SELECT 
    table_name,
    column_name,
    data_type,
    numeric_precision
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name = 'leads_lead'
  AND column_name = 'id';

-- Check if there's a sequence for leads_lead.id
SELECT 
    pg_get_serial_sequence('leads_lead', 'id') as sequence_name;

-- Check the current max lead_number values to see if we're near integer limit
SELECT 
    'leads table' as source,
    MAX(CAST(SUBSTRING(lead_number FROM 2) AS bigint)) as max_lead_number
FROM leads
WHERE lead_number ~ '^L[0-9]+$'
UNION ALL
SELECT 
    'leads_lead table' as source,
    MAX(id) as max_lead_number
FROM leads_lead;

