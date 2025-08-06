-- Create lead_stage_reasons table
CREATE TABLE IF NOT EXISTS lead_stage_reasons (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    
    -- Basic Information
    name VARCHAR(255) NOT NULL,
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
ALTER TABLE lead_stage_reasons ENABLE ROW LEVEL SECURITY;

-- Policy for users to view lead stage reasons
CREATE POLICY "Users can view lead stage reasons" ON lead_stage_reasons
    FOR SELECT USING (true);

-- Policy for authenticated users to insert lead stage reasons
CREATE POLICY "Authenticated users can insert lead stage reasons" ON lead_stage_reasons
    FOR INSERT WITH CHECK (auth.uid() IS NOT NULL);

-- Policy for authenticated users to update lead stage reasons
CREATE POLICY "Authenticated users can update lead stage reasons" ON lead_stage_reasons
    FOR UPDATE USING (auth.uid() IS NOT NULL);

-- Policy for authenticated users to delete lead stage reasons
CREATE POLICY "Authenticated users can delete lead stage reasons" ON lead_stage_reasons
    FOR DELETE USING (auth.uid() IS NOT NULL);

-- Create indexes for better performance
CREATE INDEX idx_lead_stage_reasons_name ON lead_stage_reasons(name);
CREATE INDEX idx_lead_stage_reasons_order_value ON lead_stage_reasons(order_value);
CREATE INDEX idx_lead_stage_reasons_is_active ON lead_stage_reasons(is_active);
CREATE INDEX idx_lead_stage_reasons_firm_id ON lead_stage_reasons(firm_id);

-- Insert lead stage reason data from the first screenshot
INSERT INTO lead_stage_reasons (name, order_value) VALUES
    ('test', 1),
    ('spam', 2),
    ('double - same source', 3),
    ('double -diff. source', 4),
    ('no intent', 5),
    ('non active category', 6),
    ('IrrelevantBackground', 7),
    ('incorrect contact', 8),
    ('no legal eligibility', 9),
    ('no profitability', 10),
    ('can''t be reached', 11),
    ('expired', 12);

-- Create updated_at trigger
CREATE OR REPLACE FUNCTION update_lead_stage_reasons_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER update_lead_stage_reasons_updated_at
    BEFORE UPDATE ON lead_stage_reasons
    FOR EACH ROW
    EXECUTE FUNCTION update_lead_stage_reasons_updated_at(); 