-- ============================================================================
-- CREATE HISTORY TABLES
-- This script creates history tables for tracking all changes to:
-- - leads (new leads)
-- - leads_lead (legacy leads)
-- - meetings
-- - finances_paymentplanrow (legacy payment plans)
-- - payment_plans (new payment plans)
--
-- Each history table includes:
-- - history_id: Primary key for the history record
-- - original_id: Reference to the original record
-- - changed_by: Employee ID (BIGINT) who made the change
-- - changed_at: Timestamp when the change was made
-- - change_type: Type of change ('insert', 'update', 'delete')
-- - All original columns from the source table (exact match)
-- ============================================================================

-- ============================================================================
-- 1. HISTORY_PAYMENT_PLANS - History table for new payment plans
-- ============================================================================
CREATE TABLE IF NOT EXISTS history_payment_plans (
    -- History tracking columns
    history_id BIGSERIAL PRIMARY KEY,
    original_id INTEGER NOT NULL, -- Reference to the original payment plan id
    changed_by BIGINT, -- Employee ID who made the change
    changed_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    change_type TEXT NOT NULL DEFAULT 'update', -- 'insert', 'update', 'delete'
    
    -- Copy ALL columns from payment_plans table (exact match)
    id INTEGER,
    lead_ids UUID,
    due_percent NUMERIC(5, 2),
    due_date DATE,
    value NUMERIC(12, 2),
    value_vat NUMERIC(12, 2),
    client_name TEXT,
    payment_order TEXT,
    proforma TEXT,
    notes TEXT,
    cdate DATE,
    udate DATE,
    paid BOOLEAN,
    paid_at TIMESTAMP WITH TIME ZONE,
    paid_by TEXT,
    contract_id UUID,
    percent NUMERIC,
    currency_id TEXT,
    updated_by TEXT,
    created_by CHARACTER VARYING(255),
    creator_id BIGINT,
    firm_id BIGINT,
    due_by_id BIGINT,
    "order" NUMERIC,
    cancel_date DATE,
    client_id BIGINT,
    value_base NUMERIC DEFAULT 0,
    vat_value_base NUMERIC,
    date DATE,
    currency TEXT,
    lead_id UUID,
    legacy_id BIGINT,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    ready_to_pay BOOLEAN DEFAULT FALSE,
    ready_to_pay_by BIGINT
);

-- Create indexes for history_payment_plans
CREATE INDEX IF NOT EXISTS idx_history_payment_plans_original_id ON history_payment_plans(original_id);
CREATE INDEX IF NOT EXISTS idx_history_payment_plans_changed_at ON history_payment_plans(changed_at);
CREATE INDEX IF NOT EXISTS idx_history_payment_plans_changed_by ON history_payment_plans(changed_by);
CREATE INDEX IF NOT EXISTS idx_history_payment_plans_lead_id ON history_payment_plans(lead_id);
CREATE INDEX IF NOT EXISTS idx_history_payment_plans_lead_ids ON history_payment_plans(lead_ids);
CREATE INDEX IF NOT EXISTS idx_history_payment_plans_legacy_id ON history_payment_plans(legacy_id);
CREATE INDEX IF NOT EXISTS idx_history_payment_plans_change_type ON history_payment_plans(change_type);

-- Add comments
COMMENT ON TABLE history_payment_plans IS 'History table tracking all changes to payment_plans (new payment plans) table';
COMMENT ON COLUMN history_payment_plans.history_id IS 'Primary key for history record';
COMMENT ON COLUMN history_payment_plans.original_id IS 'Reference to the original payment plan id in payment_plans table';
COMMENT ON COLUMN history_payment_plans.changed_by IS 'Employee ID who made the change';
COMMENT ON COLUMN history_payment_plans.changed_at IS 'Timestamp when the change was made';
COMMENT ON COLUMN history_payment_plans.change_type IS 'Type of change: insert, update, or delete';

-- ============================================================================
-- 2. HISTORY_FINANCES_PAYMENTPLANROW - History table for legacy payment plans
-- ============================================================================
CREATE TABLE IF NOT EXISTS history_finances_paymentplanrow (
    -- History tracking columns
    history_id BIGSERIAL PRIMARY KEY,
    original_id BIGINT NOT NULL, -- Reference to the original payment plan row id
    changed_by BIGINT, -- Employee ID who made the change
    changed_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    change_type TEXT NOT NULL DEFAULT 'update', -- 'insert', 'update', 'delete'
    
    -- Copy ALL columns from finances_paymentplanrow table (exact match)
    id BIGINT,
    cdate DATE,
    udate DATE,
    date DATE,
    actual_date DATE,
    value NUMERIC,
    creator_id BIGINT,
    firm_id BIGINT,
    lead_id TEXT,
    notes TEXT,
    value_base NUMERIC,
    due_by_id BIGINT,
    due_date DATE,
    "order" BIGINT,
    vat_value NUMERIC DEFAULT 0,
    vat_value_base NUMERIC DEFAULT 0,
    cancel_date DATE,
    client_id BIGINT,
    uid TEXT,
    currency_id BIGINT,
    due_percent TEXT,
    ready_to_pay BOOLEAN DEFAULT FALSE,
    ready_to_pay_by BIGINT
);

-- Create indexes for history_finances_paymentplanrow
CREATE INDEX IF NOT EXISTS idx_history_finances_paymentplanrow_original_id ON history_finances_paymentplanrow(original_id);
CREATE INDEX IF NOT EXISTS idx_history_finances_paymentplanrow_changed_at ON history_finances_paymentplanrow(changed_at);
CREATE INDEX IF NOT EXISTS idx_history_finances_paymentplanrow_changed_by ON history_finances_paymentplanrow(changed_by);
CREATE INDEX IF NOT EXISTS idx_history_finances_paymentplanrow_lead_id ON history_finances_paymentplanrow(lead_id);
CREATE INDEX IF NOT EXISTS idx_history_finances_paymentplanrow_client_id ON history_finances_paymentplanrow(client_id);
CREATE INDEX IF NOT EXISTS idx_history_finances_paymentplanrow_change_type ON history_finances_paymentplanrow(change_type);

-- Add comments
COMMENT ON TABLE history_finances_paymentplanrow IS 'History table tracking all changes to finances_paymentplanrow (legacy payment plans) table';
COMMENT ON COLUMN history_finances_paymentplanrow.history_id IS 'Primary key for history record';
COMMENT ON COLUMN history_finances_paymentplanrow.original_id IS 'Reference to the original payment plan row id in finances_paymentplanrow table';
COMMENT ON COLUMN history_finances_paymentplanrow.changed_by IS 'Employee ID who made the change';
COMMENT ON COLUMN history_finances_paymentplanrow.changed_at IS 'Timestamp when the change was made';
COMMENT ON COLUMN history_finances_paymentplanrow.change_type IS 'Type of change: insert, update, or delete';

-- ============================================================================
-- 3. HISTORY_LEADS - History table for new leads
-- ============================================================================
CREATE TABLE IF NOT EXISTS history_leads (
    -- History tracking columns
    history_id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    original_id UUID NOT NULL, -- Reference to the original lead id
    changed_by BIGINT, -- Employee ID who made the change
    changed_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    change_type TEXT NOT NULL DEFAULT 'update', -- 'insert', 'update', 'delete'
    
    -- Copy ALL columns from leads table (exact match)
    id UUID,
    lead_number TEXT,
    name TEXT,
    email TEXT,
    phone TEXT,
    source TEXT,
    language TEXT,
    topic TEXT,
    facts TEXT,
    special_notes TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    status TEXT DEFAULT 'new',
    tags TEXT,
    anchor TEXT,
    probability INTEGER DEFAULT 50,
    general_notes TEXT,
    scheduler TEXT DEFAULT '---',
    manager TEXT DEFAULT '---',
    helper TEXT DEFAULT '---',
    expert TEXT DEFAULT '---',
    closer TEXT DEFAULT '---',
    mobile TEXT DEFAULT '---',
    additional_contacts JSONB DEFAULT '[]'::jsonb,
    potential_metrics JSONB,
    desired_location BIGINT,
    section_eligibility TEXT,
    eligibility_status TEXT,
    eligibility_status_timestamp TEXT,
    expert_notes JSONB,
    handler_notes JSONB,
    teams_meeting_url TEXT,
    meeting_date DATE,
    meeting_time TIME WITHOUT TIME ZONE,
    meeting_manager TEXT,
    meeting_location TEXT DEFAULT 'Teams',
    meeting_brief TEXT,
    meeting_currency TEXT DEFAULT 'NIS',
    meeting_amount NUMERIC(10, 2) DEFAULT 0.0,
    onedrive_folder_link TEXT,
    manual_interactions JSONB,
    stage BIGINT DEFAULT 0,
    meeting_scheduling_notes TEXT,
    next_followup DATE,
    followup TEXT,
    potential_applicants TEXT,
    potential_applicants_meeting INTEGER,
    proposal_total NUMERIC,
    proposal_currency TEXT,
    meeting_total NUMERIC,
    meeting_total_currency TEXT,
    meeting_payment_form TEXT,
    special_notes_meeting TEXT,
    number_of_applicants_meeting INTEGER,
    balance NUMERIC,
    balance_currency TEXT,
    proposal_text TEXT,
    date_signed DATE,
    created_by TEXT,
    category TEXT,
    comments JSONB DEFAULT '[]'::jsonb,
    label TEXT,
    highlighted_by JSONB DEFAULT '[]'::jsonb,
    collection_label TEXT,
    collection_comments JSONB,
    handler TEXT,
    payment_plan JSONB,
    special_notes_last_edited_by TEXT,
    special_notes_last_edited_at TIMESTAMP WITH TIME ZONE,
    general_notes_last_edited_by TEXT,
    general_notes_last_edited_at TIMESTAMP WITH TIME ZONE,
    tags_last_edited_by TEXT,
    tags_last_edited_at TIMESTAMP WITH TIME ZONE,
    anchor_last_edited_by TEXT,
    anchor_last_edited_at TIMESTAMP WITH TIME ZONE,
    facts_last_edited_by TEXT,
    facts_last_edited_at TIMESTAMP WITH TIME ZONE,
    communication_started_by TEXT,
    communication_started_at TIMESTAMP WITH TIME ZONE,
    unactivated_by TEXT,
    unactivated_at TIMESTAMP WITH TIME ZONE,
    last_stage_changed_by TEXT,
    last_stage_changed_at TIMESTAMP WITH TIME ZONE,
    potential_value NUMERIC,
    stage_changed_by CHARACTER VARYING(255),
    stage_changed_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    created_by_full_name CHARACTER VARYING(255),
    client_country TEXT,
    handler_stage TEXT DEFAULT 'pending_review',
    lawyer TEXT,
    expert_eligibility_assessed BOOLEAN DEFAULT FALSE,
    expert_eligibility_date TIMESTAMP WITH TIME ZONE,
    expert_eligibility_assessed_by TEXT,
    documents_uploaded_date TIMESTAMP WITH TIME ZONE,
    documents_uploaded_by TEXT,
    payment_due_date DATE,
    auto_email_meeting_summary BOOLEAN DEFAULT FALSE,
    language_preference CHARACTER VARYING(10) DEFAULT 'en',
    unactivation_reason TEXT,
    idss BIGINT,
    cdate DATE,
    udate DATE,
    meeting_datetime TEXT,
    meeting_location_old TEXT,
    meeting_url TEXT,
    creator_id BIGINT,
    currency_id BIGINT,
    case_handler_id BIGINT,
    language_id BIGINT,
    meeting_lawyer_id BIGINT,
    meeting_manager_id BIGINT,
    meeting_scheduler_id BIGINT,
    meeting_total_currency_id BIGINT,
    source_id BIGINT,
    stage_date DATE,
    auto BOOLEAN,
    source_external_id BIGINT,
    marketing_data JSONB,
    category_id BIGINT,
    ball BIGINT,
    meeting_collection_id BIGINT,
    meeting_paid BOOLEAN,
    proposal TEXT,
    priority BIGINT,
    followup_log TEXT,
    meeting_complexity BIGINT,
    meeting_car_no TEXT,
    meeting_probability TEXT,
    meeting_confirmation TIMESTAMP WITH TIME ZONE,
    meeting_location_id BIGINT,
    meeting_id BIGINT,
    deactivate_notes TEXT,
    vat TEXT DEFAULT 'TRUE',
    legal_potential BIGINT,
    revenue_potential BIGINT,
    financial_ability BIGINT,
    seriousness BIGINT,
    exclusive_handler_id BIGINT,
    eligibile BOOLEAN,
    anchor_full_name TEXT,
    total_base NUMERIC,
    bonus_paid NUMERIC,
    autocall BOOLEAN,
    eligibility_date DATE,
    anchor_id BIGINT,
    manual_id TEXT,
    master_id TEXT,
    closer_id BIGINT,
    expert_id BIGINT,
    reason_id BIGINT,
    latest_interaction TIMESTAMP WITH TIME ZONE,
    sales_roles_locked BOOLEAN,
    docs_url TEXT,
    vat_value NUMERIC,
    vat_value_base NUMERIC,
    management_notes TEXT,
    kind BIGINT,
    dependent BOOLEAN,
    potential_total NUMERIC,
    potential_total_base NUMERIC,
    expert_notes_last_edited_by TEXT,
    expert_notes_last_edited_at TIMESTAMP WITH TIME ZONE,
    handler_notes_last_edited_by TEXT,
    handler_notes_last_edited_at TIMESTAMP WITH TIME ZONE,
    section_eligibility_last_edited_by TEXT,
    section_eligibility_last_edited_at TIMESTAMP WITH TIME ZONE,
    eligibility_status_last_edited_by TEXT,
    eligibility_status_last_edited_at TIMESTAMP WITH TIME ZONE,
    expert_comments JSONB DEFAULT '[]'::jsonb,
    pipeline_comments JSONB DEFAULT '[]'::jsonb,
    expert_label CHARACTER VARYING(255),
    pipeline_label CHARACTER VARYING(255),
    expert_page_comments JSONB DEFAULT '[]'::jsonb,
    expert_page_label CHARACTER VARYING(255),
    expert_page_highlighted_by TEXT[] DEFAULT '{}'::text[],
    subcontractor_fee NUMERIC DEFAULT 0,
    eligible BOOLEAN DEFAULT FALSE,
    country_id BIGINT,
    category_last_edited_by TEXT,
    category_last_edited_at TIMESTAMP WITH TIME ZONE,
    file_id TEXT,
    meeting_confirmed BOOLEAN,
    meeting_confirmation_by BIGINT,
    whatsapp_profile_picture_url TEXT,
    conected BOOLEAN,
    ai_summary TEXT,
    source_url TEXT
);

-- Create indexes for history_leads
CREATE INDEX IF NOT EXISTS idx_history_leads_original_id ON history_leads(original_id);
CREATE INDEX IF NOT EXISTS idx_history_leads_changed_at ON history_leads(changed_at);
CREATE INDEX IF NOT EXISTS idx_history_leads_changed_by ON history_leads(changed_by);
CREATE INDEX IF NOT EXISTS idx_history_leads_lead_number ON history_leads(lead_number);
CREATE INDEX IF NOT EXISTS idx_history_leads_change_type ON history_leads(change_type);
CREATE INDEX IF NOT EXISTS idx_history_leads_stage ON history_leads(stage);
CREATE INDEX IF NOT EXISTS idx_history_leads_created_at ON history_leads(created_at DESC);

-- Add comments
COMMENT ON TABLE history_leads IS 'History table tracking all changes to leads (new leads) table';
COMMENT ON COLUMN history_leads.history_id IS 'Primary key for history record';
COMMENT ON COLUMN history_leads.original_id IS 'Reference to the original lead id in leads table';
COMMENT ON COLUMN history_leads.changed_by IS 'Employee ID who made the change';
COMMENT ON COLUMN history_leads.changed_at IS 'Timestamp when the change was made';
COMMENT ON COLUMN history_leads.change_type IS 'Type of change: insert, update, or delete';

-- ============================================================================
-- 4. HISTORY_LEADS_LEAD - History table for legacy leads
-- ============================================================================
CREATE TABLE IF NOT EXISTS history_leads_lead (
    -- History tracking columns
    history_id BIGSERIAL PRIMARY KEY,
    original_id BIGINT NOT NULL, -- Reference to the original lead id
    changed_by BIGINT, -- Employee ID who made the change
    changed_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    change_type TEXT NOT NULL DEFAULT 'update', -- 'insert', 'update', 'delete'
    
    -- Copy ALL columns from leads_lead table (exact match)
    id BIGINT,
    cdate TIMESTAMP WITH TIME ZONE,
    udate TIMESTAMP WITH TIME ZONE,
    name TEXT,
    topic TEXT,
    mobile TEXT,
    phone TEXT,
    email TEXT,
    special_notes TEXT,
    notes TEXT,
    meeting_datetime TEXT,
    meeting_location_old TEXT,
    meeting_url TEXT,
    meeting_total TEXT,
    meeting_fop TEXT,
    probability TEXT,
    total TEXT,
    meeting_brief TEXT,
    next_followup TEXT,
    file_id TEXT,
    first_payment TEXT,
    creator_id TEXT,
    currency_id BIGINT,
    case_handler_id BIGINT,
    firm_id BIGINT,
    language_id BIGINT,
    meeting_lawyer_id BIGINT,
    meeting_manager_id BIGINT,
    meeting_scheduler_id BIGINT,
    meeting_total_currency_id BIGINT,
    source_id BIGINT,
    stage BIGINT,
    stage_date TEXT,
    status BIGINT,
    description TEXT,
    auto TEXT,
    source_external_id TEXT,
    source_url TEXT,
    marketing_data TEXT,
    category TEXT,
    ball BIGINT,
    additional_emails TEXT,
    additional_phones TEXT,
    meeting_collection_id TEXT,
    meeting_paid TEXT,
    proposal TEXT,
    priority BIGINT,
    meeting_date TEXT,
    meeting_time TEXT,
    followup_log TEXT,
    initial_probability TEXT,
    meeting_complexity BIGINT,
    meeting_car_no TEXT,
    meeting_probability TEXT,
    proposed_solution TEXT,
    meeting_confirmation TEXT,
    meeting_location_id TEXT,
    meeting_id TEXT,
    meeting_scheduling_notes TEXT,
    deactivate_notes TEXT,
    old_reason TEXT,
    vat TEXT,
    legal_potential TEXT,
    revenue_potential TEXT,
    desired_location TEXT,
    financial_ability BIGINT,
    seriousness BIGINT,
    external_notes TEXT,
    exclusive_handler_id TEXT,
    eligibile TEXT,
    anchor_full_name TEXT,
    total_base TEXT,
    bonus_paid TEXT,
    autocall TEXT,
    eligibilty_date TEXT,
    no_of_applicants BIGINT,
    anchor_id TEXT,
    manual_id TEXT,
    master_id TEXT,
    closer_id BIGINT,
    expert_id BIGINT,
    potential_applicants TEXT,
    reason_id BIGINT,
    latest_interaction TIMESTAMP WITH TIME ZONE,
    expert_examination TEXT,
    expert_opinion TEXT,
    sales_roles_locked TEXT,
    expiry_date TEXT,
    docs_url TEXT,
    vat_value TEXT,
    vat_value_base TEXT,
    handler_expert_opinion TEXT,
    management_notes TEXT,
    kind TEXT,
    dependent TEXT,
    potential_total TEXT,
    potential_total_base TEXT,
    category_id BIGINT,
    lead_number BIGINT,
    expert_eligibility_assessed BOOLEAN DEFAULT FALSE,
    expert_eligibility_date TIMESTAMP WITH TIME ZONE,
    expert_eligibility_assessed_by TEXT,
    special_notes_last_edited_by TEXT,
    special_notes_last_edited_at TIMESTAMP WITH TIME ZONE,
    notes_last_edited_by TEXT,
    notes_last_edited_at TIMESTAMP WITH TIME ZONE,
    description_last_edited_by TEXT,
    description_last_edited_at TIMESTAMP WITH TIME ZONE,
    anchor_full_name_last_edited_by TEXT,
    anchor_full_name_last_edited_at TIMESTAMP WITH TIME ZONE,
    category_last_edited_by TEXT,
    category_last_edited_at TIMESTAMP WITH TIME ZONE,
    expert_notes_last_edited_by TEXT,
    expert_notes_last_edited_at TIMESTAMP WITH TIME ZONE,
    handler_notes_last_edited_by TEXT,
    handler_notes_last_edited_at TIMESTAMP WITH TIME ZONE,
    section_eligibility_last_edited_by TEXT,
    section_eligibility_last_edited_at TIMESTAMP WITH TIME ZONE,
    eligibility_status_last_edited_by TEXT,
    eligibility_status_last_edited_at TIMESTAMP WITH TIME ZONE,
    documents_uploaded_by TEXT,
    documents_uploaded_date TIMESTAMP WITH TIME ZONE,
    expert_notes JSONB,
    handler_notes JSONB,
    onedrive_folder_link TEXT,
    section_eligibility TEXT,
    eligibility_status TEXT,
    eligibility_status_timestamp TIMESTAMP WITH TIME ZONE,
    stage_changed_by CHARACTER VARYING(255),
    stage_changed_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    unactivated_by TEXT,
    unactivated_at TIMESTAMP WITH TIME ZONE,
    unactivation_reason TEXT,
    comments JSONB DEFAULT '[]'::jsonb,
    label CHARACTER VARYING(255),
    expert_comments JSONB DEFAULT '[]'::jsonb,
    pipeline_comments JSONB DEFAULT '[]'::jsonb,
    expert_label CHARACTER VARYING(255),
    pipeline_label CHARACTER VARYING(255),
    expert_page_comments JSONB DEFAULT '[]'::jsonb,
    expert_page_label CHARACTER VARYING(255),
    expert_page_highlighted_by TEXT[] DEFAULT '{}'::text[],
    collection_label TEXT,
    collection_comments TEXT,
    subcontractor_fee NUMERIC DEFAULT 0,
    meeting_confirmed BOOLEAN DEFAULT FALSE,
    meeting_confirmation_by BIGINT,
    ai_summary TEXT
);

-- Create indexes for history_leads_lead
CREATE INDEX IF NOT EXISTS idx_history_leads_lead_original_id ON history_leads_lead(original_id);
CREATE INDEX IF NOT EXISTS idx_history_leads_lead_changed_at ON history_leads_lead(changed_at);
CREATE INDEX IF NOT EXISTS idx_history_leads_lead_changed_by ON history_leads_lead(changed_by);
CREATE INDEX IF NOT EXISTS idx_history_leads_lead_manual_id ON history_leads_lead(manual_id);
CREATE INDEX IF NOT EXISTS idx_history_leads_lead_lead_number ON history_leads_lead(lead_number);
CREATE INDEX IF NOT EXISTS idx_history_leads_lead_change_type ON history_leads_lead(change_type);
CREATE INDEX IF NOT EXISTS idx_history_leads_lead_stage ON history_leads_lead(stage);
CREATE INDEX IF NOT EXISTS idx_history_leads_lead_cdate ON history_leads_lead(cdate DESC);

-- Add comments
COMMENT ON TABLE history_leads_lead IS 'History table tracking all changes to leads_lead (legacy leads) table';
COMMENT ON COLUMN history_leads_lead.history_id IS 'Primary key for history record';
COMMENT ON COLUMN history_leads_lead.original_id IS 'Reference to the original lead id in leads_lead table';
COMMENT ON COLUMN history_leads_lead.changed_by IS 'Employee ID who made the change';
COMMENT ON COLUMN history_leads_lead.changed_at IS 'Timestamp when the change was made';
COMMENT ON COLUMN history_leads_lead.change_type IS 'Type of change: insert, update, or delete';

-- ============================================================================
-- 5. HISTORY_MEETINGS - History table for meetings
-- ============================================================================
CREATE TABLE IF NOT EXISTS history_meetings (
    -- History tracking columns
    history_id BIGSERIAL PRIMARY KEY,
    original_id INTEGER NOT NULL, -- Reference to the original meeting id
    changed_by BIGINT, -- Employee ID who made the change
    changed_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    change_type TEXT NOT NULL DEFAULT 'update', -- 'insert', 'update', 'delete'
    
    -- Copy ALL columns from meetings table (exact match)
    id INTEGER,
    client_id UUID,
    meeting_date DATE,
    meeting_time TIME WITHOUT TIME ZONE,
    meeting_location TEXT DEFAULT 'Teams',
    meeting_manager TEXT,
    meeting_currency TEXT DEFAULT 'NIS',
    meeting_amount NUMERIC(10, 2) DEFAULT 0.0,
    meeting_brief TEXT,
    scheduler TEXT,
    helper TEXT,
    expert TEXT,
    teams_meeting_url TEXT,
    last_edited_timestamp TIMESTAMP WITH TIME ZONE,
    last_edited_by TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    status TEXT DEFAULT 'scheduled',
    lawyer TEXT,
    teams_id CHARACTER VARYING(255),
    meeting_subject TEXT,
    started_at TIMESTAMP WITH TIME ZONE,
    ended_at TIMESTAMP WITH TIME ZONE,
    transcript_url TEXT,
    legacy_lead_id BIGINT,
    attendance_probability CHARACTER VARYING(20) DEFAULT 'Medium',
    complexity CHARACTER VARYING(20) DEFAULT 'Simple',
    car_number TEXT DEFAULT '',
    calendar_type CHARACTER VARYING(20) NOT NULL DEFAULT 'potential_client',
    extern1 TEXT,
    extern2 TEXT
);

-- Create indexes for history_meetings
CREATE INDEX IF NOT EXISTS idx_history_meetings_original_id ON history_meetings(original_id);
CREATE INDEX IF NOT EXISTS idx_history_meetings_changed_at ON history_meetings(changed_at);
CREATE INDEX IF NOT EXISTS idx_history_meetings_changed_by ON history_meetings(changed_by);
CREATE INDEX IF NOT EXISTS idx_history_meetings_client_id ON history_meetings(client_id);
CREATE INDEX IF NOT EXISTS idx_history_meetings_legacy_lead_id ON history_meetings(legacy_lead_id);
CREATE INDEX IF NOT EXISTS idx_history_meetings_change_type ON history_meetings(change_type);
CREATE INDEX IF NOT EXISTS idx_history_meetings_meeting_date ON history_meetings(meeting_date);

-- Add comments
COMMENT ON TABLE history_meetings IS 'History table tracking all changes to meetings table';
COMMENT ON COLUMN history_meetings.history_id IS 'Primary key for history record';
COMMENT ON COLUMN history_meetings.original_id IS 'Reference to the original meeting id in meetings table';
COMMENT ON COLUMN history_meetings.changed_by IS 'Employee ID who made the change';
COMMENT ON COLUMN history_meetings.changed_at IS 'Timestamp when the change was made';
COMMENT ON COLUMN history_meetings.change_type IS 'Type of change: insert, update, or delete';

-- ============================================================================
-- SUMMARY
-- ============================================================================
-- Created 5 history tables:
-- 1. history_payment_plans - for new payment plans
-- 2. history_finances_paymentplanrow - for legacy payment plans
-- 3. history_leads - for new leads
-- 4. history_leads_lead - for legacy leads
-- 5. history_meetings - for meetings
--
-- Each table includes:
-- - history_id: Primary key for the history record
-- - original_id: Reference to the original record
-- - changed_by: Employee ID (BIGINT) who made the change
-- - changed_at: Timestamp when the change was made
-- - change_type: Type of change ('insert', 'update', 'delete')
-- - All original columns from the source table (exact match with data types)
--
-- Next steps:
-- 1. Create triggers on the original tables to automatically insert into history tables
-- 2. Create functions to handle the history tracking logic
-- 3. Set up RLS policies if needed
-- ============================================================================
