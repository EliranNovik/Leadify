-- Create vats table
CREATE TABLE IF NOT EXISTS vats (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    
    -- Basic Information
    value NUMERIC(5, 2) NOT NULL, -- VAT rate (e.g., 1.18, 1.17)
    effective_date DATE NOT NULL, -- Effective date for the VAT rate
    
    -- Organization
    firm_id UUID, -- Can be linked to firms table later if needed
    order_value INTEGER DEFAULT 0, -- Display order
    
    -- Status
    is_active BOOLEAN DEFAULT true NOT NULL,
    
    -- Timestamps
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    created_by UUID REFERENCES auth.users(id),
    updated_by UUID REFERENCES auth.users(id)
);

-- Add RLS policies
ALTER TABLE vats ENABLE ROW LEVEL SECURITY;

-- Policy for users to view vats
CREATE POLICY "Users can view vats" ON vats
    FOR SELECT USING (true);

-- Policy for authenticated users to insert vats
CREATE POLICY "Authenticated users can insert vats" ON vats
    FOR INSERT WITH CHECK (auth.uid() IS NOT NULL);

-- Policy for authenticated users to update vats
CREATE POLICY "Authenticated users can update vats" ON vats
    FOR UPDATE USING (auth.uid() IS NOT NULL);

-- Policy for authenticated users to delete vats
CREATE POLICY "Authenticated users can delete vats" ON vats
    FOR DELETE USING (auth.uid() IS NOT NULL);

-- Create indexes for better performance
CREATE INDEX idx_vats_value ON vats(value);
CREATE INDEX idx_vats_effective_date ON vats(effective_date);
CREATE INDEX idx_vats_firm_id ON vats(firm_id);
CREATE INDEX idx_vats_is_active ON vats(is_active);
CREATE INDEX idx_vats_order_value ON vats(order_value);

-- Insert vats data from screenshots
INSERT INTO vats (value, effective_date, is_active) VALUES
    (1.18, '2025-01-01', TRUE),
    (1.17, '2020-01-01', TRUE);

-- Create updated_at trigger
CREATE OR REPLACE FUNCTION update_vats_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER update_vats_updated_at
    BEFORE UPDATE ON vats
    FOR EACH ROW
    EXECUTE FUNCTION update_vats_updated_at(); 