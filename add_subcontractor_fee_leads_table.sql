-- Add subcontractor_fee column to leads table for new leads
-- This matches the column we added to leads_lead table for legacy leads

-- Add subcontractor_fee column to leads table
ALTER TABLE public.leads 
ADD COLUMN IF NOT EXISTS subcontractor_fee numeric DEFAULT 0;

-- Add potential_total column to leads table (text field for potential value)
ALTER TABLE public.leads 
ADD COLUMN IF NOT EXISTS potential_total text DEFAULT NULL;

-- Add comment to document the purpose
COMMENT ON COLUMN public.leads.subcontractor_fee IS 'Subcontractor fee amount for the lead';
COMMENT ON COLUMN public.leads.potential_total IS 'Potential total value as text';

-- Verify the columns were added
SELECT column_name, data_type, is_nullable, column_default 
FROM information_schema.columns 
WHERE table_name = 'leads' 
AND column_name IN ('subcontractor_fee', 'potential_total')
ORDER BY column_name;
