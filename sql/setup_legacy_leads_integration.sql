-- Setup Legacy Leads Integration
-- This script sets up the integration of the legacy leads_lead table
-- without merging it with the existing leads table

-- 1. First, let's check if we need to add any missing columns to the existing leads table
-- to support the legacy data display

-- 2. Create a view to combine both tables for display purposes
CREATE OR REPLACE VIEW combined_leads_view AS
SELECT 
    -- Legacy leads (leads_lead table)
    id as legacy_id,
    name,
    email,
    phone,
    mobile,
    topic,
    stage as stage_id,
    source_id,
    cdate as created_at,
    udate as updated_at,
    'legacy' as lead_type,
    id::text as lead_number,
    -- Add other columns from leads_lead as needed
    special_notes,
    notes,
    meeting_datetime,
    meeting_location_old,
    meeting_url,
    meeting_total,
    meeting_fop,
    probability,
    total,
    meeting_brief,
    next_followup,
    meeting_lawyer_id,
    meeting_manager_id,
    meeting_scheduler_id,
    meeting_total_currency_id,
    stage_date,
    status,
    description,
    auto,
    source_external_id,
    source_url,
    marketing_data,
    category_id,
    ball,
    additional_emails,
    additional_phones,
    meeting_collection_id,
    meeting_paid,
    proposal,
    priority,
    meeting_date,
    meeting_time,
    followup_log,
    initial_probability,
    meeting_complexity,
    meeting_car_no,
    meeting_probability,
    proposed_solution,
    meeting_confirmation,
    meeting_location_id,
    revenue_potential,
    desired_location,
    financial_ability,
    seriousness,
    external_notes,
    exclusive_handler_id,
    potential_applicants,
    reason_id,
    latest_interaction,
    expert_examination,
    expert_opinion,
    sales_roles_locked,
    expiry_date,
    docs_url,
    vat_value,
    vat_value_base,
    handler_expert_opinion,
    management_notes,
    kind,
    dependent,
    potential_total,
    potential_total_base,
    eligibile,
    anchor_full_name,
    total_base,
    bonus_paid,
    autocall,
    eligibilty_date,
    no_of_applicants,
    anchor_id,
    manual_id,
    master_id,
    closer_id,
    expert_id,
    meeting_scheduling_notes,
    deactivate_notes,
    old_reason,
    vat,
    legal_potential
FROM leads_lead

UNION ALL

SELECT 
    -- New leads (leads table)
    id as legacy_id,
    name,
    email,
    phone,
    mobile,
    topic,
    stage::int as stage_id,
    source::int as source_id,
    created_at,
    created_at as updated_at,
    'new' as lead_type,
    lead_number,
    -- Add other columns from leads as needed
    special_notes,
    NULL as notes,
    NULL as meeting_datetime,
    NULL as meeting_location_old,
    NULL as meeting_url,
    NULL as meeting_total,
    NULL as meeting_fop,
    NULL as probability,
    NULL as total,
    NULL as meeting_brief,
    NULL as next_followup,
    NULL as meeting_lawyer_id,
    NULL as meeting_manager_id,
    NULL as meeting_scheduler_id,
    NULL as meeting_total_currency_id,
    NULL as stage_date,
    NULL as status,
    NULL as description,
    NULL as auto,
    NULL as source_external_id,
    NULL as source_url,
    NULL as marketing_data,
    category as category_id,
    NULL as ball,
    NULL as additional_emails,
    NULL as additional_phones,
    NULL as meeting_collection_id,
    NULL as meeting_paid,
    NULL as proposal,
    NULL as priority,
    NULL as meeting_date,
    NULL as meeting_time,
    NULL as followup_log,
    NULL as initial_probability,
    NULL as meeting_complexity,
    NULL as meeting_car_no,
    NULL as meeting_probability,
    NULL as proposed_solution,
    NULL as meeting_confirmation,
    NULL as meeting_location_id,
    NULL as revenue_potential,
    NULL as desired_location,
    NULL as financial_ability,
    NULL as seriousness,
    NULL as external_notes,
    NULL as exclusive_handler_id,
    NULL as potential_applicants,
    NULL as reason_id,
    NULL as latest_interaction,
    NULL as expert_examination,
    NULL as expert_opinion,
    NULL as sales_roles_locked,
    NULL as expiry_date,
    NULL as docs_url,
    NULL as vat_value,
    NULL as vat_value_base,
    NULL as handler_expert_opinion,
    NULL as management_notes,
    NULL as kind,
    NULL as dependent,
    NULL as potential_total,
    NULL as potential_total_base,
    NULL as eligibile,
    NULL as anchor_full_name,
    NULL as total_base,
    NULL as bonus_paid,
    NULL as autocall,
    NULL as eligibilty_date,
    NULL as no_of_applicants,
    NULL as anchor_id,
    NULL as manual_id,
    NULL as master_id,
    NULL as closer_id,
    NULL as expert_id,
    NULL as meeting_scheduling_notes,
    NULL as deactivate_notes,
    NULL as old_reason,
    NULL as vat,
    NULL as legal_potential
FROM leads;

-- Note: Indexes cannot be created directly on views in PostgreSQL
-- The underlying tables (leads_lead and leads) should have their own indexes for performance

-- 4. Create a function to get lead by ID (handles both legacy and new)
CREATE OR REPLACE FUNCTION get_lead_by_id(lead_id INTEGER, p_lead_type TEXT DEFAULT NULL)
RETURNS TABLE (
    legacy_id INTEGER,
    name TEXT,
    email TEXT,
    phone TEXT,
    mobile TEXT,
    topic TEXT,
    stage_id INTEGER,
    source_id INTEGER,
    created_at TIMESTAMPTZ,
    updated_at TIMESTAMPTZ,
    lead_type TEXT,
    lead_number TEXT
) AS $$
BEGIN
    IF p_lead_type = 'legacy' OR p_lead_type IS NULL THEN
        RETURN QUERY
        SELECT 
            l.id as legacy_id,
            l.name,
            l.email,
            l.phone,
            l.mobile,
            l.topic,
            l.stage as stage_id,
            l.source_id as source_id,
            l.cdate as created_at,
            l.udate as updated_at,
            'legacy' as lead_type,
            l.id::text as lead_number
        FROM leads_lead l
        WHERE l.id = lead_id;
    END IF;
    
    IF p_lead_type = 'new' OR p_lead_type IS NULL THEN
        RETURN QUERY
        SELECT 
            l.id as legacy_id,
            l.name,
            l.email,
            l.phone,
            l.mobile,
            l.topic,
            l.stage::int as stage_id,
            l.source::int as source_id,
            l.created_at,
            l.updated_at,
            'new' as lead_type,
            l.lead_number
        FROM leads l
        WHERE l.id = lead_id;
    END IF;
END;
$$ LANGUAGE plpgsql;

-- 5. Create RLS policies for the view
ALTER VIEW combined_leads_view SET (security_invoker = true);

-- Grant permissions
GRANT SELECT ON combined_leads_view TO authenticated;
GRANT EXECUTE ON FUNCTION get_lead_by_id TO authenticated;

-- 6. Add comments for documentation
COMMENT ON VIEW combined_leads_view IS 'Combined view of legacy leads_lead and new leads tables';
COMMENT ON FUNCTION get_lead_by_id IS 'Function to get lead by ID, handling both legacy and new leads';
