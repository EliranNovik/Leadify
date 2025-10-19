-- SQL Improvements for Contact Management Tables
-- This script adds foreign keys, constraints, and indexes for better functionality

-- 1. Add foreign key constraints to lead_leadcontact table
-- This ensures referential integrity between leads, contacts, and their relationships

-- Add foreign key to leads_contact table
ALTER TABLE public.lead_leadcontact 
ADD CONSTRAINT fk_lead_leadcontact_contact_id 
FOREIGN KEY (contact_id) REFERENCES public.leads_contact(id) ON DELETE CASCADE;

-- Add foreign key to leads_lead table (if the column exists)
-- Note: This assumes leads_lead.id exists and is the correct reference
ALTER TABLE public.lead_leadcontact 
ADD CONSTRAINT fk_lead_leadcontact_lead_id 
FOREIGN KEY (lead_id) REFERENCES public.leads_lead(id) ON DELETE CASCADE;

-- 2. Add indexes for better query performance
CREATE INDEX IF NOT EXISTS idx_lead_leadcontact_lead_id ON public.lead_leadcontact(lead_id);
CREATE INDEX IF NOT EXISTS idx_lead_leadcontact_contact_id ON public.lead_leadcontact(contact_id);
CREATE INDEX IF NOT EXISTS idx_lead_leadcontact_main ON public.lead_leadcontact(main) WHERE main = 'true';

-- 3. Add constraints to ensure data integrity

-- Ensure main field is either 'true' or 'false'
ALTER TABLE public.lead_leadcontact 
ADD CONSTRAINT chk_lead_leadcontact_main 
CHECK (main IN ('true', 'false') OR main IS NULL);

-- Ensure at least one of contact_id or lead_id is not null
ALTER TABLE public.lead_leadcontact 
ADD CONSTRAINT chk_lead_leadcontact_not_both_null 
CHECK (contact_id IS NOT NULL OR lead_id IS NOT NULL);

-- 4. Add useful indexes on leads_contact table
CREATE INDEX IF NOT EXISTS idx_leads_contact_email ON public.leads_contact(email) WHERE email IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_leads_contact_phone ON public.leads_contact(phone) WHERE phone IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_leads_contact_mobile ON public.leads_contact(mobile) WHERE mobile IS NOT NULL;

-- 5. Create a view for easier contact management
CREATE OR REPLACE VIEW contact_with_lead_info AS
SELECT 
    lc.id as contact_id,
    lc.name as contact_name,
    lc.email,
    lc.phone,
    lc.mobile,
    lc.cdate,
    lc.udate,
    llc.id as relationship_id,
    llc.main,
    llc.lead_id,
    ll.manual_id as lead_number,
    ll.name as lead_name,
    ll.stage,
    ll.category_id
FROM public.leads_contact lc
LEFT JOIN public.lead_leadcontact llc ON lc.id = llc.contact_id
LEFT JOIN public.leads_lead ll ON llc.lead_id = ll.id
ORDER BY llc.lead_id, llc.main DESC, lc.name;

-- 6. Create a function to get all contacts for a lead
CREATE OR REPLACE FUNCTION get_lead_contacts(p_lead_id BIGINT)
RETURNS TABLE (
    contact_id BIGINT,
    contact_name TEXT,
    email TEXT,
    phone TEXT,
    mobile TEXT,
    is_main BOOLEAN
) AS $$
BEGIN
    RETURN QUERY
    SELECT 
        lc.id,
        lc.name,
        lc.email,
        lc.phone,
        lc.mobile,
        (llc.main = 'true') as is_main
    FROM public.leads_contact lc
    JOIN public.lead_leadcontact llc ON lc.id = llc.contact_id
    WHERE llc.lead_id = p_lead_id
    ORDER BY llc.main DESC, lc.name;
END;
$$ LANGUAGE plpgsql;

-- 7. Create a function to get the main contact for a lead
CREATE OR REPLACE FUNCTION get_main_contact(p_lead_id BIGINT)
RETURNS TABLE (
    contact_id BIGINT,
    contact_name TEXT,
    email TEXT,
    phone TEXT,
    mobile TEXT
) AS $$
BEGIN
    RETURN QUERY
    SELECT 
        lc.id,
        lc.name,
        lc.email,
        lc.phone,
        lc.mobile
    FROM public.leads_contact lc
    JOIN public.lead_leadcontact llc ON lc.id = llc.contact_id
    WHERE llc.lead_id = p_lead_id 
    AND llc.main = 'true'
    LIMIT 1;
END;
$$ LANGUAGE plpgsql;

-- 8. Grant permissions for authenticated users
GRANT SELECT ON contact_with_lead_info TO authenticated;
GRANT EXECUTE ON FUNCTION get_lead_contacts(BIGINT) TO authenticated;
GRANT EXECUTE ON FUNCTION get_main_contact(BIGINT) TO authenticated;

-- 9. Add comments for documentation
COMMENT ON TABLE public.leads_contact IS 'Stores contact information for leads';
COMMENT ON TABLE public.lead_leadcontact IS 'Junction table linking leads to their contacts with relationship metadata';
COMMENT ON COLUMN public.lead_leadcontact.main IS 'Indicates if this is the main contact for the lead (true/false)';
COMMENT ON COLUMN public.lead_leadcontact.contact_id IS 'Reference to leads_contact.id';
COMMENT ON COLUMN public.lead_leadcontact.lead_id IS 'Reference to leads_lead.id';

-- 10. Create a trigger to automatically update udate when contacts are modified
CREATE OR REPLACE FUNCTION update_contact_udate()
RETURNS TRIGGER AS $$
BEGIN
    NEW.udate = CURRENT_DATE;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_update_contact_udate
    BEFORE UPDATE ON public.leads_contact
    FOR EACH ROW
    EXECUTE FUNCTION update_contact_udate();

-- 11. Create a trigger to ensure only one main contact per lead
CREATE OR REPLACE FUNCTION ensure_single_main_contact()
RETURNS TRIGGER AS $$
BEGIN
    -- If setting main to 'true', set all other contacts for this lead to 'false'
    IF NEW.main = 'true' THEN
        UPDATE public.lead_leadcontact 
        SET main = 'false' 
        WHERE lead_id = NEW.lead_id 
        AND id != NEW.id;
    END IF;
    
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_ensure_single_main_contact
    BEFORE INSERT OR UPDATE ON public.lead_leadcontact
    FOR EACH ROW
    EXECUTE FUNCTION ensure_single_main_contact();
