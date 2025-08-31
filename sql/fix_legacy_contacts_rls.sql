-- Enable RLS on leads_contact table
ALTER TABLE public.leads_contact ENABLE ROW LEVEL SECURITY;

-- Create policies for leads_contact table
CREATE POLICY "Enable read access for authenticated users" ON public.leads_contact
    FOR SELECT USING (auth.role() = 'authenticated');

CREATE POLICY "Enable insert access for authenticated users" ON public.leads_contact
    FOR INSERT WITH CHECK (auth.role() = 'authenticated');

CREATE POLICY "Enable update access for authenticated users" ON public.leads_contact
    FOR UPDATE USING (auth.role() = 'authenticated');

CREATE POLICY "Enable delete access for authenticated users" ON public.leads_contact
    FOR DELETE USING (auth.role() = 'authenticated');

-- Enable RLS on lead_leadcontact table
ALTER TABLE public.lead_leadcontact ENABLE ROW LEVEL SECURITY;

-- Create policies for lead_leadcontact table
CREATE POLICY "Enable read access for authenticated users" ON public.lead_leadcontact
    FOR SELECT USING (auth.role() = 'authenticated');

CREATE POLICY "Enable insert access for authenticated users" ON public.lead_leadcontact
    FOR INSERT WITH CHECK (auth.role() = 'authenticated');

CREATE POLICY "Enable update access for authenticated users" ON public.lead_leadcontact
    FOR UPDATE USING (auth.role() = 'authenticated');

CREATE POLICY "Enable delete access for authenticated users" ON public.lead_leadcontact
    FOR DELETE USING (auth.role() = 'authenticated');
