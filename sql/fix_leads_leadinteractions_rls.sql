-- Enable Row Level Security for leads_leadinteractions table
ALTER TABLE public.leads_leadinteractions ENABLE ROW LEVEL SECURITY;

-- Add policy to allow authenticated users to read all leads_leadinteractions
CREATE POLICY "Allow authenticated users to read leads_leadinteractions" ON public.leads_leadinteractions
    FOR SELECT
    TO authenticated
    USING (true);

-- Add policy to allow authenticated users to insert leads_leadinteractions
CREATE POLICY "Allow authenticated users to insert leads_leadinteractions" ON public.leads_leadinteractions
    FOR INSERT
    TO authenticated
    WITH CHECK (true);

-- Add policy to allow authenticated users to update leads_leadinteractions
CREATE POLICY "Allow authenticated users to update leads_leadinteractions" ON public.leads_leadinteractions
    FOR UPDATE
    TO authenticated
    USING (true)
    WITH CHECK (true);

-- Add policy to allow authenticated users to delete leads_leadinteractions
CREATE POLICY "Allow authenticated users to delete leads_leadinteractions" ON public.leads_leadinteractions
    FOR DELETE
    TO authenticated
    USING (true);
