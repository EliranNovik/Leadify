-- Add comments and label columns to leads_lead table for legacy lead support
-- This enables commenting and labeling functionality for legacy leads

-- Add comments column (JSONB to store array of comment objects)
ALTER TABLE public.leads_lead 
ADD COLUMN IF NOT EXISTS comments JSONB DEFAULT '[]'::jsonb;

-- Add label column (varchar to store label text)
ALTER TABLE public.leads_lead 
ADD COLUMN IF NOT EXISTS label VARCHAR(255);

-- Add comment to describe the comments column structure
COMMENT ON COLUMN public.leads_lead.comments IS 'JSONB array of comment objects with structure: [{text: string, timestamp: string, user: string}]';

-- Add comment to describe the label column
COMMENT ON COLUMN public.leads_lead.label IS 'Label text for categorizing legacy leads (e.g., High Value, Low Risk, etc.)';

-- Update RLS policies to include the new columns
-- Note: This assumes RLS is already enabled on the table

-- Grant permissions for authenticated users
GRANT SELECT, UPDATE ON public.leads_lead TO authenticated;

-- Show the updated table structure
SELECT 
    column_name, 
    data_type, 
    is_nullable, 
    column_default
FROM information_schema.columns 
WHERE table_name = 'leads_lead' 
AND column_name IN ('comments', 'label')
ORDER BY column_name;

-- Verify the columns were added successfully
SELECT 'Comments and label columns added to leads_lead table successfully' as status;
