-- Create languages table
CREATE TABLE IF NOT EXISTS languages (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    
    -- Basic Information
    name VARCHAR(255) NOT NULL,
    iso_code VARCHAR(10) NOT NULL,
    
    -- Relationships
    firm_id UUID, -- Can be linked to firms table later if needed
    
    -- Status
    is_active BOOLEAN DEFAULT true NOT NULL,
    
    -- Timestamps
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    created_by UUID REFERENCES auth.users(id),
    updated_by UUID REFERENCES auth.users(id)
);

-- Add RLS policies
ALTER TABLE languages ENABLE ROW LEVEL SECURITY;

-- Policy for users to view languages
CREATE POLICY "Users can view languages" ON languages
    FOR SELECT USING (true);

-- Policy for authenticated users to insert languages
CREATE POLICY "Authenticated users can insert languages" ON languages
    FOR INSERT WITH CHECK (auth.uid() IS NOT NULL);

-- Policy for authenticated users to update languages
CREATE POLICY "Authenticated users can update languages" ON languages
    FOR UPDATE USING (auth.uid() IS NOT NULL);

-- Policy for authenticated users to delete languages
CREATE POLICY "Authenticated users can delete languages" ON languages
    FOR DELETE USING (auth.uid() IS NOT NULL);

-- Create indexes for better performance
CREATE INDEX idx_languages_name ON languages(name);
CREATE INDEX idx_languages_iso_code ON languages(iso_code);
CREATE INDEX idx_languages_is_active ON languages(is_active);
CREATE INDEX idx_languages_firm_id ON languages(firm_id);

-- Insert language data from the first screenshot
INSERT INTO languages (name, iso_code) VALUES
    ('AR', 'ar'),
    ('DE', 'de'),
    ('EN', 'en'),
    ('ES', 'es'),
    ('FR', 'fr'),
    ('HE', 'he'),
    ('Por', 'pt'),
    ('RU', 'ru'),
    ('Spanish', 'es');

-- Create updated_at trigger
CREATE OR REPLACE FUNCTION update_languages_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER update_languages_updated_at
    BEFORE UPDATE ON languages
    FOR EACH ROW
    EXECUTE FUNCTION update_languages_updated_at(); 