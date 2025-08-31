-- Comprehensive script to verify and add tracking columns
-- This script will check if columns exist and add them if they don't

-- Function to safely add columns if they don't exist
CREATE OR REPLACE FUNCTION add_column_if_not_exists(
    p_table_name text,
    p_column_name text,
    p_column_type text
) RETURNS void AS $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 
        FROM information_schema.columns 
        WHERE table_name = p_table_name 
        AND column_name = p_column_name
    ) THEN
        EXECUTE format('ALTER TABLE %I ADD COLUMN %I %s', p_table_name, p_column_name, p_column_type);
        RAISE NOTICE 'Added column % to table %', p_column_name, p_table_name;
    ELSE
        RAISE NOTICE 'Column % already exists in table %', p_column_name, p_table_name;
    END IF;
END;
$$ LANGUAGE plpgsql;

-- Add tracking columns to leads table
SELECT add_column_if_not_exists('leads', 'expert_notes_last_edited_by', 'TEXT');
SELECT add_column_if_not_exists('leads', 'expert_notes_last_edited_at', 'TIMESTAMP WITH TIME ZONE');
SELECT add_column_if_not_exists('leads', 'handler_notes_last_edited_by', 'TEXT');
SELECT add_column_if_not_exists('leads', 'handler_notes_last_edited_at', 'TIMESTAMP WITH TIME ZONE');
SELECT add_column_if_not_exists('leads', 'section_eligibility_last_edited_by', 'TEXT');
SELECT add_column_if_not_exists('leads', 'section_eligibility_last_edited_at', 'TIMESTAMP WITH TIME ZONE');
SELECT add_column_if_not_exists('leads', 'eligibility_status_last_edited_by', 'TEXT');
SELECT add_column_if_not_exists('leads', 'eligibility_status_last_edited_at', 'TIMESTAMP WITH TIME ZONE');

-- Add tracking columns to leads_lead table
SELECT add_column_if_not_exists('leads_lead', 'expert_notes_last_edited_by', 'TEXT');
SELECT add_column_if_not_exists('leads_lead', 'expert_notes_last_edited_at', 'TIMESTAMP WITH TIME ZONE');
SELECT add_column_if_not_exists('leads_lead', 'handler_notes_last_edited_by', 'TEXT');
SELECT add_column_if_not_exists('leads_lead', 'handler_notes_last_edited_at', 'TIMESTAMP WITH TIME ZONE');
SELECT add_column_if_not_exists('leads_lead', 'section_eligibility_last_edited_by', 'TEXT');
SELECT add_column_if_not_exists('leads_lead', 'section_eligibility_last_edited_at', 'TIMESTAMP WITH TIME ZONE');
SELECT add_column_if_not_exists('leads_lead', 'eligibility_status_last_edited_by', 'TEXT');
SELECT add_column_if_not_exists('leads_lead', 'eligibility_status_last_edited_at', 'TIMESTAMP WITH TIME ZONE');

-- Add missing data columns to leads_lead if they don't exist
SELECT add_column_if_not_exists('leads_lead', 'expert_notes', 'JSONB');
SELECT add_column_if_not_exists('leads_lead', 'handler_notes', 'JSONB');
SELECT add_column_if_not_exists('leads_lead', 'section_eligibility', 'TEXT');
SELECT add_column_if_not_exists('leads_lead', 'eligibility_status', 'TEXT');
SELECT add_column_if_not_exists('leads_lead', 'eligibility_status_timestamp', 'TIMESTAMP WITH TIME ZONE');
SELECT add_column_if_not_exists('leads_lead', 'expert_eligibility_assessed', 'BOOLEAN DEFAULT FALSE');
SELECT add_column_if_not_exists('leads_lead', 'expert_eligibility_date', 'TIMESTAMP WITH TIME ZONE');
SELECT add_column_if_not_exists('leads_lead', 'expert_eligibility_assessed_by', 'TEXT');
SELECT add_column_if_not_exists('leads_lead', 'onedrive_folder_link', 'TEXT');

-- Add indexes for performance
CREATE INDEX IF NOT EXISTS idx_leads_expert_notes_edited_at ON leads(expert_notes_last_edited_at);
CREATE INDEX IF NOT EXISTS idx_leads_handler_notes_edited_at ON leads(handler_notes_last_edited_at);
CREATE INDEX IF NOT EXISTS idx_leads_section_eligibility_edited_at ON leads(section_eligibility_last_edited_at);
CREATE INDEX IF NOT EXISTS idx_leads_eligibility_status_edited_at ON leads(eligibility_status_last_edited_at);

CREATE INDEX IF NOT EXISTS idx_leads_lead_expert_notes_edited_at ON leads_lead(expert_notes_last_edited_at);
CREATE INDEX IF NOT EXISTS idx_leads_lead_handler_notes_edited_at ON leads_lead(handler_notes_last_edited_at);
CREATE INDEX IF NOT EXISTS idx_leads_lead_section_eligibility_edited_at ON leads_lead(section_eligibility_last_edited_at);
CREATE INDEX IF NOT EXISTS idx_leads_lead_eligibility_status_edited_at ON leads_lead(eligibility_status_last_edited_at);

-- Verify columns exist
SELECT 
    'leads' as table_name,
    column_name,
    data_type
FROM information_schema.columns 
WHERE table_name = 'leads' 
AND column_name LIKE '%_last_edited_%'
ORDER BY column_name;

SELECT 
    'leads_lead' as table_name,
    column_name,
    data_type
FROM information_schema.columns 
WHERE table_name = 'leads_lead' 
AND (column_name LIKE '%_last_edited_%' OR column_name IN ('expert_notes', 'handler_notes', 'section_eligibility', 'eligibility_status'))
ORDER BY column_name;

-- Clean up
DROP FUNCTION IF EXISTS add_column_if_not_exists(text, text, text);
