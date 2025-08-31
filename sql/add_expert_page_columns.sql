-- Add expert page specific columns for both leads and leads_lead tables
-- This adds separate columns for expert page functionality

-- For the main leads table (new leads)
ALTER TABLE public.leads 
ADD COLUMN IF NOT EXISTS expert_page_comments JSONB DEFAULT '[]'::jsonb,
ADD COLUMN IF NOT EXISTS expert_page_label VARCHAR(255),
ADD COLUMN IF NOT EXISTS expert_page_highlighted_by TEXT[] DEFAULT '{}';

-- For the legacy leads_lead table
ALTER TABLE public.leads_lead 
ADD COLUMN IF NOT EXISTS expert_page_comments JSONB DEFAULT '[]'::jsonb,
ADD COLUMN IF NOT EXISTS expert_page_label VARCHAR(255),
ADD COLUMN IF NOT EXISTS expert_page_highlighted_by TEXT[] DEFAULT '{}';

-- Add comments to describe the new columns for leads table
COMMENT ON COLUMN public.leads.expert_page_comments IS 'JSONB array of expert page comment objects with structure: [{text: string, timestamp: string, user: string}]';
COMMENT ON COLUMN public.leads.expert_page_label IS 'Label text for categorizing leads in expert page (e.g., High Value, Low Risk, etc.)';
COMMENT ON COLUMN public.leads.expert_page_highlighted_by IS 'Array of user IDs who have highlighted this lead in expert page';

-- Add comments to describe the new columns for leads_lead table
COMMENT ON COLUMN public.leads_lead.expert_page_comments IS 'JSONB array of expert page comment objects with structure: [{text: string, timestamp: string, user: string}]';
COMMENT ON COLUMN public.leads_lead.expert_page_label IS 'Label text for categorizing legacy leads in expert page (e.g., High Value, Low Risk, etc.)';
COMMENT ON COLUMN public.leads_lead.expert_page_highlighted_by IS 'Array of user IDs who have highlighted this legacy lead in expert page';

-- Grant permissions for authenticated users
GRANT SELECT, UPDATE ON public.leads TO authenticated;
GRANT SELECT, UPDATE ON public.leads_lead TO authenticated;

-- Show the updated table structure for leads table
SELECT 
    column_name, 
    data_type, 
    is_nullable, 
    column_default
FROM information_schema.columns 
WHERE table_name = 'leads' 
AND column_name IN ('expert_page_comments', 'expert_page_label', 'expert_page_highlighted_by')
ORDER BY column_name;

-- Show the updated table structure for leads_lead table
SELECT 
    column_name, 
    data_type, 
    is_nullable, 
    column_default
FROM information_schema.columns 
WHERE table_name = 'leads_lead' 
AND column_name IN ('expert_page_comments', 'expert_page_label', 'expert_page_highlighted_by')
ORDER BY column_name;

-- Verify the columns were added successfully
SELECT 'Expert page columns added to both leads and leads_lead tables successfully' as status;
