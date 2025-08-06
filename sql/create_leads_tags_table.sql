-- Create leads_tags table
CREATE TABLE IF NOT EXISTS leads_tags (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    
    -- Basic Information
    name VARCHAR(255) NOT NULL UNIQUE,
    order_value INTEGER DEFAULT 0,
    
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
ALTER TABLE leads_tags ENABLE ROW LEVEL SECURITY;

-- Policy for users to view leads_tags
CREATE POLICY "Users can view leads_tags" ON leads_tags
    FOR SELECT USING (true);

-- Policy for authenticated users to insert leads_tags
CREATE POLICY "Authenticated users can insert leads_tags" ON leads_tags
    FOR INSERT WITH CHECK (auth.uid() IS NOT NULL);

-- Policy for authenticated users to update leads_tags
CREATE POLICY "Authenticated users can update leads_tags" ON leads_tags
    FOR UPDATE USING (auth.uid() IS NOT NULL);

-- Policy for authenticated users to delete leads_tags
CREATE POLICY "Authenticated users can delete leads_tags" ON leads_tags
    FOR DELETE USING (auth.uid() IS NOT NULL);

-- Create indexes for better performance
CREATE INDEX idx_leads_tags_name ON leads_tags(name);
CREATE INDEX idx_leads_tags_order_value ON leads_tags(order_value);
CREATE INDEX idx_leads_tags_is_active ON leads_tags(is_active);
CREATE INDEX idx_leads_tags_firm_id ON leads_tags(firm_id);

-- Insert leads tags data from the first screenshot
INSERT INTO leads_tags (name, order_value) VALUES
    ('Michael Archive', 1),
    ('Mikes autocaller', 2),
    ('Not interested', 3),
    ('Not relevant', 4),
    ('on hold', 5),
    ('Paragraph 15', 6),
    ('SA, UK, Australia', 7);

-- Create updated_at trigger
CREATE OR REPLACE FUNCTION update_leads_tags_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER update_leads_tags_updated_at
    BEFORE UPDATE ON leads_tags
    FOR EACH ROW
    EXECUTE FUNCTION update_leads_tags_updated_at(); 