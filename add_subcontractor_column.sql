-- Add subcontractor_fee column to leads_lead table
-- This script only adds the subcontractor_fee column without any foreign key connections

-- Add subcontractor_fee column to leads_lead table if it doesn't exist
DO $$ 
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'leads_lead' 
        AND column_name = 'subcontractor_fee'
    ) THEN
        ALTER TABLE public.leads_lead 
        ADD COLUMN subcontractor_fee numeric DEFAULT 0;
        
        RAISE NOTICE 'Added subcontractor_fee column to leads_lead table';
    ELSE
        RAISE NOTICE 'subcontractor_fee column already exists in leads_lead table';
    END IF;
END $$;

-- Add potential_total column to leads_lead table if it doesn't exist
DO $$ 
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'leads_lead' 
        AND column_name = 'potential_total'
    ) THEN
        ALTER TABLE public.leads_lead 
        ADD COLUMN potential_total text DEFAULT NULL;
        
        RAISE NOTICE 'Added potential_total column to leads_lead table';
    ELSE
        RAISE NOTICE 'potential_total column already exists in leads_lead table';
    END IF;
END $$;

-- Add helpful comment
COMMENT ON COLUMN public.leads_lead.subcontractor_fee IS 'Fee paid to subcontractors for this lead';
COMMENT ON COLUMN public.leads_lead.potential_total IS 'Potential total value of the lead';

-- Display completion message
DO $$ 
BEGIN
    RAISE NOTICE 'Successfully added subcontractor_fee and potential_total columns to leads_lead table';
END $$;
