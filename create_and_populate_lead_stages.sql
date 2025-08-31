-- Create and populate lead_stages table
-- This script will create the table if it doesn't exist and populate it with stage mappings

-- First, let's check if the table exists
SELECT 'Checking if lead_stages table exists...' as info;

-- Create the table if it doesn't exist
CREATE TABLE IF NOT EXISTS public.lead_stages (
    id text PRIMARY KEY,
    name varchar(255) NOT NULL,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.lead_stages ENABLE ROW LEVEL SECURITY;

-- Drop existing policies if they exist
DROP POLICY IF EXISTS "Enable read access for authenticated users" ON public.lead_stages;
DROP POLICY IF EXISTS "Enable insert access for authenticated users" ON public.lead_stages;
DROP POLICY IF EXISTS "Enable update access for authenticated users" ON public.lead_stages;
DROP POLICY IF EXISTS "Enable delete access for authenticated users" ON public.lead_stages;

-- Create RLS policies
CREATE POLICY "Enable read access for authenticated users" ON public.lead_stages
    FOR SELECT USING (auth.role() = 'authenticated');

CREATE POLICY "Enable insert access for authenticated users" ON public.lead_stages
    FOR INSERT WITH CHECK (auth.role() = 'authenticated');

CREATE POLICY "Enable update access for authenticated users" ON public.lead_stages
    FOR UPDATE USING (auth.role() = 'authenticated');

CREATE POLICY "Enable delete access for authenticated users" ON public.lead_stages
    FOR DELETE USING (auth.role() = 'authenticated');

-- Grant permissions
GRANT ALL ON public.lead_stages TO authenticated;
GRANT ALL ON public.lead_stages TO service_role;

-- Show current content (should be empty initially)
SELECT 'Current lead_stages table content (before population):' as info;
SELECT id, name FROM public.lead_stages ORDER BY id;

-- Populate with data from proformainvoicerow table
INSERT INTO public.lead_stages (id, name)
SELECT id, name FROM public.proformainvoicerow
ON CONFLICT (id) DO UPDATE SET 
    name = EXCLUDED.name,
    updated_at = now();

-- Show final content
SELECT 'Final lead_stages table content:' as info;
SELECT id, name FROM public.lead_stages ORDER BY id;

-- Verify the specific stage we were debugging
SELECT 'Verifying stage 110 mapping:' as info;
SELECT id, name FROM public.lead_stages WHERE id = '110';
