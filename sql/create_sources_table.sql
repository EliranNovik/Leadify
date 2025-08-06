-- Create sources table
CREATE TABLE IF NOT EXISTS sources (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    
    -- Basic Information
    name VARCHAR(255) NOT NULL UNIQUE,
    kind VARCHAR(100) NOT NULL CHECK (kind IN ('Manual', 'API hook', 'Facebook Campaign', 'Website-GravityForms', 'Website-Elemntor API form')),
    default_topic TEXT,
    default_category VARCHAR(255),
    
    -- Campaign Information
    code INTEGER,
    campaign_id VARCHAR(255),
    bonus_formula VARCHAR(100) DEFAULT 'Standard',
    order_value INTEGER DEFAULT 0,
    
    -- Priority and Status
    priority INTEGER NOT NULL DEFAULT 1,
    is_active BOOLEAN DEFAULT true NOT NULL,
    
    -- Relationships
    firm_id UUID, -- Can be linked to firms table later if it exists
    
    -- Timestamps
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    created_by UUID REFERENCES auth.users(id),
    updated_by UUID REFERENCES auth.users(id)
);

-- Add RLS policies
ALTER TABLE sources ENABLE ROW LEVEL SECURITY;

-- Policy for users to view sources
CREATE POLICY "Users can view sources" ON sources
    FOR SELECT USING (true);

-- Policy for authenticated users to insert sources
CREATE POLICY "Authenticated users can insert sources" ON sources
    FOR INSERT WITH CHECK (auth.uid() IS NOT NULL);

-- Policy for authenticated users to update sources
CREATE POLICY "Authenticated users can update sources" ON sources
    FOR UPDATE USING (auth.uid() IS NOT NULL);

-- Policy for authenticated users to delete sources
CREATE POLICY "Authenticated users can delete sources" ON sources
    FOR DELETE USING (auth.uid() IS NOT NULL);

-- Create indexes for better performance
CREATE INDEX idx_sources_name ON sources(name);
CREATE INDEX idx_sources_kind ON sources(kind);
CREATE INDEX idx_sources_is_active ON sources(is_active);
CREATE INDEX idx_sources_priority ON sources(priority);
CREATE INDEX idx_sources_code ON sources(code);

-- Insert all sources from the provided data
INSERT INTO sources (name, kind, default_topic, code, priority, is_active) VALUES
    ('Amcon Conference', 'Manual', 'amcon conference', NULL, 1, TRUE),
    ('Art Wedding', 'Manual', NULL, NULL, 1, TRUE),
    ('ClickOn', 'API hook', 'אזרחות גרמנית', 18163, 1, TRUE),
    ('DIFFERENT', 'API hook', 'אזרחות גרמנית', 18555, 100, TRUE),
    ('Door to Romania', 'Manual', NULL, NULL, 1, TRUE),
    ('ELIGIBILITY CHECKER', 'API hook', 'German&Austrian', 31234, 100, TRUE),
    ('external publication', 'Manual', NULL, NULL, 1, TRUE),
    ('FB GERMAN USA', 'API hook', 'אזרחות גרמנית', 20105, 400, TRUE),
    ('FB גרין קארד', 'Facebook Campaign', 'גרין קארד לבן/בת זוג', 21053, 200, TRUE),
    ('FB מעמד בן זוג זר', 'Manual', 'הסדרת מעמד בן זוג זר', 16567, 100, TRUE),
    ('Flowsome', 'API hook', NULL, 26569, 400, TRUE),
    ('GenieVisa', 'Manual', NULL, NULL, 1, TRUE),
    ('Goo Eligibil Checker', 'API hook', NULL, 22201, 1, TRUE),
    ('Highteck Zone', 'API hook', NULL, 31101, 200, TRUE),
    ('Kosher Media', 'API hook', 'German&Austrian', 31521, 100, TRUE),
    ('Lawreviews', 'Manual', NULL, 30108, 100, TRUE),
    ('Lawzana', 'Manual', NULL, NULL, 1, TRUE),
    ('Linkedin Campaign', 'Website-GravityForms', 'אזרחות גרמנית', 30018, 200, TRUE),
    ('Marketism Au Low', 'API hook', 'אזרחות אוסטרית', 11383, 1, TRUE),
    ('Marketism Haredi Aus', 'API hook', 'Austria', 3428, 150, TRUE),
    ('Marketism Haredi Ger', 'API hook', 'אזרחות גרמנית', 9896, 150, TRUE),
    ('Marketism US', 'API hook', 'German Citizenship', 25851, 200, TRUE),
    ('PINK MEDIA', 'Manual', NULL, 22518, 300, TRUE),
    ('PR-digital USA', 'API hook', 'אזרחות גרמנית', 20308, 200, TRUE),
    ('PR-digital USA extra', 'API hook', 'אזרחות גרמנית', 11558, 1, TRUE),
    ('Sabatier Eligi Check', 'API hook', NULL, 22186, 300, TRUE),
    ('Sabatier EU', 'API hook', NULL, 20193, 200, TRUE),
    ('TABOOLA PNIMI', 'API hook', 'אזרחות גרמנית', 17342, 100, TRUE),
    ('Tik Tok', 'API hook', 'אזרחות גרמנית', 28723, 1, TRUE),
    ('us immigration heb', 'API hook', NULL, 11835, 1, TRUE),
    ('ZAP campaign Austria', 'API hook', 'אזרחות אוסטרית', 18921, 150, TRUE),
    ('ZAP campaign Germany', 'API hook', 'אזרחות גרמנית', 21921, 150, TRUE),
    ('בתי משפט - עזבונות', 'Manual', NULL, NULL, 1, TRUE),
    ('גוגל מעמד בן זוג זר', 'API hook', 'הסדרת מעמד בן זוג זר', 22018, 100, TRUE),
    ('חתונמי', 'Manual', NULL, NULL, 1, TRUE),
    ('Eddie Sobari', 'Manual', NULL, NULL, 1, TRUE),
    ('Meir Shua', 'Manual', NULL, NULL, 1, TRUE),
    ('Best Lawyers', 'API hook', NULL, 4392, 1, TRUE),
    ('Commercial Website', 'Manual', NULL, 20268, 100, TRUE),
    ('DIN (Lawguide)', 'API hook', NULL, 5010, 100, TRUE),
    ('Direct Email', 'Manual', NULL, NULL, 100, TRUE),
    ('Direct phone', 'Manual', NULL, NULL, 100, TRUE),
    ('Eli Rosenberg', 'Manual', NULL, NULL, 1, TRUE),
    ('Existing client', 'Manual', NULL, NULL, 1000, TRUE),
    ('Facebook', 'Manual', NULL, 1984, 1, TRUE),
    ('Facebook Germany 2', 'Facebook Campaign', 'German Passport', 3581, 100, TRUE),
    ('Facebook Germany Cam', 'Facebook Campaign', 'German Passport', 9596, 100, TRUE),
    ('Familylaw', 'Website-Elemntor API form', NULL, 8137, 1, TRUE),
    ('FB Hitazrhut', 'Manual', NULL, 3202, 1, TRUE),
    ('FB Portugal Family', 'Facebook Campaign', NULL, 7564, 1, TRUE),
    ('FB Traffic Accident', 'Facebook Campaign', NULL, 7162, 1, TRUE),
    ('FB Turkey', 'API hook', NULL, 3091, 1, FALSE),
    ('FB USA citiz child', 'Facebook Campaign', NULL, 3591, 1, TRUE),
    ('Google search', 'Manual', NULL, NULL, 1, TRUE),
    ('Immigration_is_ru', 'Manual', NULL, 20251, 100, TRUE),
    ('Instagram', 'Manual', NULL, NULL, 1, TRUE),
    ('JMG', 'API hook', NULL, 3387, 1, TRUE),
    ('Jon Simmons', 'Manual', NULL, NULL, 1, TRUE),
    ('Kishurit', 'API hook', NULL, 7639, 100, TRUE),
    ('Legal_immigration', 'API hook', NULL, 784, 300, TRUE),
    ('LinkedIn', 'Manual', NULL, NULL, 1, TRUE),
    ('Marketism Au', 'API hook', 'Austrian citizenship', 350, 300, TRUE),
    ('Marketism Ro', 'API hook', 'Romanian citizenship', 360, 1, TRUE),
    ('Moti Orange', 'Manual', NULL, NULL, 200, TRUE),
    ('Newsletter', 'Manual', NULL, NULL, 100, TRUE),
    ('other', 'Manual', NULL, NULL, 1, TRUE),
    ('PPC ADACTIVE', 'API hook', NULL, 8535, 100, TRUE),
    ('PPC World GER-AUS', 'API hook', NULL, 8375, 150, TRUE),
    ('PR-digital', 'API hook', NULL, 31845, 150, TRUE),
    ('PR DIGITAL BEST', 'API hook', 'אזרחות גרמנית', 29741, 500, TRUE),
    ('PR-DIGITAL LOW', 'API hook', 'אזרחות גרמנית', 9165, 1, TRUE),
    ('Psakdin', 'API hook', NULL, 6210, 100, TRUE),
    ('referral', 'Manual', NULL, NULL, 1000, TRUE),
    ('referr.-happy client', 'Manual', NULL, NULL, 1000, TRUE),
    ('Religious Publicat.', 'Manual', NULL, NULL, 1, TRUE),
    ('Religious Publicatio', 'Manual', NULL, 8364, 1, TRUE),
    ('Shidurit', 'API hook', NULL, 9332, 100, TRUE),
    ('Taboola Din', 'Manual', NULL, 5044, 100, TRUE),
    ('Taboola Psakdin', 'API hook', NULL, 6244, 100, TRUE),
    ('USA citiz child PPC', 'Manual', 'אזרחות אמריקאית לילדים', 8623, 1, TRUE),
    ('usa-immig.lawyer EN', 'Manual', NULL, 10013, 1, TRUE),
    ('Walk in', 'Manual', NULL, NULL, 1, TRUE),
    ('Website Form', 'Website-GravityForms', NULL, 2165, 100, TRUE),
    ('WhatsApp', 'Manual', NULL, NULL, 100, TRUE),
    ('Youtube', 'Manual', NULL, NULL, 100, TRUE),
    ('ZAP CAMPAIGN', 'API hook', NULL, 460, 150, TRUE),
    ('אדי תאונות דרכים', 'Facebook Campaign', NULL, 5653, 150, TRUE),
    ('אדי תאונות מדרכה', 'Facebook Campaign', 'דיני נזיקין', 8925, 150, TRUE),
    ('אזרחות אוסטרית גוגל', 'API hook', 'אזרחות אוסטרית', 27451, 100, TRUE),
    ('אזרחות גרמנית גוגל', 'API hook', 'אזרחות גרמנית', 31847, 200, TRUE),
    ('טאבולה תאונות דרכים', 'Manual', 'פלתד', 6531, 100, TRUE),
    ('יהודה אלחרר', 'Manual', NULL, NULL, 200, TRUE),
    ('Exisiting Lead', 'Manual', NULL, 2244, 1, TRUE),
    ('ZAP MISHPATI', 'API hook', NULL, 450, 1, TRUE);

-- Create updated_at trigger
CREATE OR REPLACE FUNCTION update_sources_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER update_sources_updated_at
    BEFORE UPDATE ON sources
    FOR EACH ROW
    EXECUTE FUNCTION update_sources_updated_at(); 