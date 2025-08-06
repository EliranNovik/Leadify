-- Create sub_categories table
CREATE TABLE IF NOT EXISTS sub_categories (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    
    -- Basic Information
    name VARCHAR(255) NOT NULL,
    
    -- Relationships
    parent_id UUID REFERENCES main_categories(id), -- Link to main_categories table
    firm_id UUID, -- Can be linked to firms table later if needed
    
    -- Ordering and Flags
    order_value INTEGER DEFAULT 0,
    is_important BOOLEAN DEFAULT false NOT NULL,
    sales_bonus_applied BOOLEAN DEFAULT false NOT NULL,
    is_anchor_based BOOLEAN DEFAULT false NOT NULL,
    
    -- Content
    facts_of_case TEXT,
    
    -- Status
    is_active BOOLEAN DEFAULT true NOT NULL,
    
    -- Timestamps
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    created_by UUID REFERENCES auth.users(id),
    updated_by UUID REFERENCES auth.users(id)
);

-- Add RLS policies
ALTER TABLE sub_categories ENABLE ROW LEVEL SECURITY;

-- Policy for users to view sub_categories
CREATE POLICY "Users can view sub_categories" ON sub_categories
    FOR SELECT USING (true);

-- Policy for authenticated users to insert sub_categories
CREATE POLICY "Authenticated users can insert sub_categories" ON sub_categories
    FOR INSERT WITH CHECK (auth.uid() IS NOT NULL);

-- Policy for authenticated users to update sub_categories
CREATE POLICY "Authenticated users can update sub_categories" ON sub_categories
    FOR UPDATE USING (auth.uid() IS NOT NULL);

-- Policy for authenticated users to delete sub_categories
CREATE POLICY "Authenticated users can delete sub_categories" ON sub_categories
    FOR DELETE USING (auth.uid() IS NOT NULL);

-- Create indexes for better performance
CREATE INDEX idx_sub_categories_name ON sub_categories(name);
CREATE INDEX idx_sub_categories_parent_id ON sub_categories(parent_id);
CREATE INDEX idx_sub_categories_firm_id ON sub_categories(firm_id);
CREATE INDEX idx_sub_categories_is_active ON sub_categories(is_active);
CREATE INDEX idx_sub_categories_order_value ON sub_categories(order_value);
CREATE INDEX idx_sub_categories_is_important ON sub_categories(is_important);

-- Insert sub categories data from all screenshots
INSERT INTO sub_categories (name, order_value, is_important, is_active) VALUES
    -- First screenshot data (Austria, Germany, Immigration Israel, USA, etc.)
    ('Left bef. 1933/Citiz', 1, TRUE, TRUE),
    ('Lived bef 1933,le af', 2, TRUE, TRUE),
    ('Extra Family Member', 3, TRUE, TRUE),
    ('Labor Camps or DPC', 4, TRUE, TRUE),
    ('Port. for non Jewish', 5, TRUE, TRUE),
    ('Undefined', 6, TRUE, TRUE),
    ('Undefined', 7, TRUE, TRUE),
    ('Extra Family Member', 8, TRUE, TRUE),
    ('Left bef. 1933/Citiz', 9, TRUE, TRUE),
    ('Lived bef 1933,le af', 10, TRUE, TRUE),
    ('Passports for childr', 11, TRUE, TRUE),
    ('Portugal Family', 12, TRUE, TRUE),
    ('Portugal/Spain gener', 13, TRUE, TRUE),
    ('Aliyah/A1', 14, TRUE, TRUE),
    ('Asylum Seekers', 15, TRUE, TRUE),
    ('B1 Expert worker vis', 16, TRUE, TRUE),
    ('B1 for caregivers', 17, TRUE, TRUE),
    ('B1 regular work visa', 18, TRUE, TRUE),
    ('B2 Tourist visa', 19, TRUE, TRUE),
    ('Elderly Parent', 20, TRUE, TRUE),
    
    -- Second screenshot data (Immigration Israel, Portugal, etc.)
    ('Extra Family Member', 21, TRUE, TRUE),
    ('IDF exemption matter', 22, TRUE, TRUE),
    ('Joint life/Family r', 23, TRUE, TRUE),
    ('Parent of IDF sold', 24, TRUE, TRUE),
    ('A2 Student visa', 25, TRUE, TRUE),
    ('A3 Clergy visa', 26, TRUE, TRUE),
    ('A4 complimentary vis', 27, TRUE, TRUE),
    ('A5 temporary resid.v', 28, TRUE, TRUE),
    ('Permanent residency', 29, TRUE, TRUE),
    ('West Bank Matters', 30, TRUE, TRUE),
    ('East Jerusalem Citiz', 31, TRUE, TRUE),
    ('Portugal for descend', 32, TRUE, TRUE),
    ('Proxy marriage for s', 33, TRUE, TRUE),
    ('Entry into Israel', 34, TRUE, TRUE),
    ('Entry into the Wes', 35, TRUE, TRUE),
    ('Humanitarian visas', 36, TRUE, TRUE),
    ('Paternity tests', 37, TRUE, TRUE),
    ('Visas for Palestinia', 38, TRUE, TRUE),
    ('Appeals to MOI', 39, TRUE, TRUE),
    ('Special appeals trib', 40, TRUE, TRUE),
    ('Detail Change', 41, FALSE, FALSE),
    ('District court petit', 42, TRUE, TRUE),
    ('IDF ForeignVolunteer', 43, FALSE, FALSE),
    ('Supreme court appeal', 44, TRUE, TRUE),
    
    -- Third screenshot data (Commer/Civil/Adm/Fam, Small without meetin, etc.)
    ('Probate order', 45, TRUE, TRUE),
    ('Real estate and prop', 46, TRUE, TRUE),
    ('Intern. Debt collect', 47, TRUE, TRUE),
    ('Labor law', 48, TRUE, TRUE),
    ('Non imm. appeals/pet', 49, TRUE, TRUE),
    ('Arnona', 50, TRUE, TRUE),
    ('Libel \\ Slander', 51, TRUE, TRUE),
    ('Gun license', 52, TRUE, TRUE),
    ('Political Party regi', 53, TRUE, TRUE),
    ('Credit ranking', 54, TRUE, TRUE),
    ('Civil litigation', 55, TRUE, TRUE),
    ('Israeli debt collect', 56, TRUE, TRUE),
    ('DNA for child suppor', 57, TRUE, TRUE),
    ('Small claims', 58, TRUE, TRUE),
    ('Tax Law', 59, TRUE, TRUE),
    ('Hi-Tech', 60, TRUE, TRUE),
    ('Undefined', 61, TRUE, TRUE),
    ('Doc. Acquisitions', 62, TRUE, TRUE),
    ('FBI background check', 63, TRUE, TRUE),
    ('Notarizations', 64, TRUE, TRUE),
    ('Notarized translat', 65, TRUE, TRUE),
    ('Proxy marriages', 66, TRUE, TRUE),
    ('Disabled Parking', 67, TRUE, TRUE),
    ('Utah Marriage', 68, TRUE, TRUE),
    
    -- Fourth screenshot data (Small without meetin, other, etc.)
    ('Enduring POAs of 5K', 69, TRUE, TRUE),
    ('Legal Opinion', 70, TRUE, TRUE),
    ('Regular POAs', 71, TRUE, TRUE),
    ('Undefined', 72, TRUE, TRUE),
    ('Feasibility', 73, TRUE, TRUE),
    ('Intellectual Propert', 74, TRUE, TRUE),
    ('Door to Romania', 75, TRUE, TRUE),
    ('Feasibility', 76, TRUE, TRUE),
    
    -- Fifth screenshot data (Poland, Germany, Austria, etc.)
    ('Feasibility', 77, TRUE, TRUE),
    ('Feasibility', 78, TRUE, TRUE),
    ('Feasibility', 79, TRUE, TRUE),
    ('German\\Austria', 80, TRUE, TRUE),
    ('German\\Austrian', 81, TRUE, TRUE),
    ('Other Citizenships', 82, TRUE, TRUE),
    ('Poland', 83, TRUE, TRUE),
    ('France', 84, TRUE, TRUE),
    ('Romania', 85, TRUE, TRUE),
    ('Hungary', 86, TRUE, TRUE),
    ('Greece', 87, TRUE, TRUE),
    ('Bulgaria', 88, TRUE, TRUE),
    ('Paid meeting', 89, TRUE, TRUE),
    ('Paid meeting', 90, TRUE, TRUE),
    ('Paid meeting', 91, TRUE, TRUE),
    ('Paid meeting', 92, TRUE, TRUE),
    ('Lithuania', 93, TRUE, TRUE),
    ('Paid meeting', 94, TRUE, TRUE),
    ('Paid meeting', 95, TRUE, TRUE),
    ('Russian', 96, TRUE, TRUE),
    ('Holland', 97, TRUE, TRUE),
    ('Slovakia', 98, TRUE, TRUE),
    ('Transportation law', 99, TRUE, TRUE),
    ('Bankruptcy', 100, TRUE, TRUE),
    
    -- Sixth screenshot data (other, Other Citizenships, Immigration Israel, Commer/Civil/Adm/Fam)
    ('Class Actions', 101, TRUE, TRUE),
    ('Dubai', 102, TRUE, TRUE),
    ('UK', 103, TRUE, TRUE),
    ('Canada', 104, TRUE, TRUE),
    ('Education Law', 105, TRUE, TRUE),
    ('Status in Israel', 106, FALSE, FALSE),
    ('Corporate law', 107, TRUE, TRUE),
    ('Administrative Law', 108, FALSE, FALSE),
    ('Custody', 109, FALSE, FALSE),
    ('Marriage', 110, FALSE, FALSE),
    ('Negative BDI', 111, FALSE, FALSE),
    ('Psychiatric hospital', 112, FALSE, FALSE),
    ('Subsidiary', 113, FALSE, FALSE),
    ('Family reunification', 114, FALSE, FALSE),
    ('Undefined', 115, TRUE, TRUE),
    ('Feasibility', 116, TRUE, TRUE);

-- Create updated_at trigger
CREATE OR REPLACE FUNCTION update_sub_categories_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER update_sub_categories_updated_at
    BEFORE UPDATE ON sub_categories
    FOR EACH ROW
    EXECUTE FUNCTION update_sub_categories_updated_at(); 