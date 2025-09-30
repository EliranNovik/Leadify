-- Create a view for master leads with their sub-leads
-- This will handle all the logic server-side for better performance

-- First, let's create a function that returns master lead data with sub-leads
CREATE OR REPLACE FUNCTION get_master_lead_with_sub_leads(master_lead_id TEXT)
RETURNS TABLE (
    id BIGINT,
    lead_number TEXT,
    actual_lead_id TEXT,
    manual_id TEXT,
    name TEXT,
    total TEXT,
    stage BIGINT,
    is_master BOOLEAN,
    master_id TEXT
) 
LANGUAGE plpgsql
AS $$
BEGIN
    RETURN QUERY
    WITH master_lead AS (
        SELECT 
            ll.id,
            COALESCE(ll.manual_id, ll.id::TEXT) as lead_number,
            ll.id::TEXT as actual_lead_id,
            ll.manual_id,
            ll.name,
            ll.total,
            ll.stage,
            true as is_master,
            ll.master_id
        FROM leads_lead ll
        WHERE ll.id::TEXT = master_lead_id
    ),
    sub_leads AS (
        SELECT 
            ll.id,
            CASE 
                WHEN ll.stage = 100 THEN 'C' || COALESCE(ll.manual_id, ll.id::TEXT)
                ELSE COALESCE(ll.manual_id, ll.id::TEXT)
            END as lead_number,
            ll.id::TEXT as actual_lead_id,
            ll.manual_id,
            ll.name,
            ll.total,
            ll.stage,
            false as is_master,
            ll.master_id
        FROM leads_lead ll
        WHERE ll.master_id = master_lead_id
    )
    SELECT * FROM master_lead
    UNION ALL
    SELECT * FROM sub_leads
    ORDER BY is_master DESC, id ASC;
END;
$$;

-- Create an index on master_id for better performance
CREATE INDEX IF NOT EXISTS idx_leads_lead_master_id ON leads_lead(master_id);

-- Create an index on id for faster lookups
CREATE INDEX IF NOT EXISTS idx_leads_lead_id ON leads_lead(id);

-- Grant necessary permissions
GRANT EXECUTE ON FUNCTION get_master_lead_with_sub_leads(TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION get_master_lead_with_sub_leads(TEXT) TO anon;
