-- Add separate comment columns for expert page and pipeline page comments
-- This allows different types of comments to be stored separately

-- For the main leads table (new leads)
ALTER TABLE public.leads 
ADD COLUMN IF NOT EXISTS expert_comments JSONB DEFAULT '[]'::jsonb,
ADD COLUMN IF NOT EXISTS pipeline_comments JSONB DEFAULT '[]'::jsonb;

-- For the legacy leads_lead table
ALTER TABLE public.leads_lead 
ADD COLUMN IF NOT EXISTS expert_comments JSONB DEFAULT '[]'::jsonb,
ADD COLUMN IF NOT EXISTS pipeline_comments JSONB DEFAULT '[]'::jsonb;

-- Add comments to describe the new columns
COMMENT ON COLUMN public.leads.expert_comments IS 'JSONB array of expert page comment objects with structure: [{text: string, timestamp: string, user: string}]';
COMMENT ON COLUMN public.leads.pipeline_comments IS 'JSONB array of pipeline page comment objects with structure: [{text: string, timestamp: string, user: string}]';
COMMENT ON COLUMN public.leads_lead.expert_comments IS 'JSONB array of expert page comment objects with structure: [{text: string, timestamp: string, user: string}]';
COMMENT ON COLUMN public.leads_lead.pipeline_comments IS 'JSONB array of pipeline page comment objects with structure: [{text: string, timestamp: string, user: string}]';

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
AND column_name IN ('expert_comments', 'pipeline_comments')
ORDER BY column_name;

-- Show the updated table structure for leads_lead table
SELECT 
    column_name, 
    data_type, 
    is_nullable, 
    column_default
FROM information_schema.columns 
WHERE table_name = 'leads_lead' 
AND column_name IN ('expert_comments', 'pipeline_comments')
ORDER BY column_name;

-- Verify the columns were added successfully
SELECT 'Separate comment columns added to both leads and leads_lead tables successfully' as status;
