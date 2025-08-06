-- Create currencies table
CREATE TABLE IF NOT EXISTS currencies (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    
    -- Basic Information
    name VARCHAR(10) NOT NULL, -- Currency symbol/name (e.g., '₪', '€', '$', '£')
    iso_code VARCHAR(3) NOT NULL UNIQUE, -- ISO 4217 currency code (e.g., 'ILS', 'EUR', 'USD', 'GBP')
    
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
ALTER TABLE currencies ENABLE ROW LEVEL SECURITY;

-- Policy for users to view currencies
CREATE POLICY "Users can view currencies" ON currencies
    FOR SELECT USING (true);

-- Policy for authenticated users to insert currencies
CREATE POLICY "Authenticated users can insert currencies" ON currencies
    FOR INSERT WITH CHECK (auth.uid() IS NOT NULL);

-- Policy for authenticated users to update currencies
CREATE POLICY "Authenticated users can update currencies" ON currencies
    FOR UPDATE USING (auth.uid() IS NOT NULL);

-- Policy for authenticated users to delete currencies
CREATE POLICY "Authenticated users can delete currencies" ON currencies
    FOR DELETE USING (auth.uid() IS NOT NULL);

-- Create indexes for better performance
CREATE INDEX idx_currencies_name ON currencies(name);
CREATE INDEX idx_currencies_iso_code ON currencies(iso_code);
CREATE INDEX idx_currencies_firm_id ON currencies(firm_id);
CREATE INDEX idx_currencies_is_active ON currencies(is_active);
CREATE INDEX idx_currencies_order_value ON currencies(order_value);

-- Insert currencies data from screenshots
INSERT INTO currencies (name, iso_code, order_value, is_active) VALUES
    ('₪', 'ILS', 100, TRUE),  -- Israeli New Shekel
    ('€', 'EUR', 101, TRUE),  -- Euro
    ('$', 'USD', 102, TRUE),  -- US Dollar
    ('£', 'GBP', 103, TRUE);  -- British Pound

-- Create updated_at trigger
CREATE OR REPLACE FUNCTION update_currencies_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER update_currencies_updated_at
    BEFORE UPDATE ON currencies
    FOR EACH ROW
    EXECUTE FUNCTION update_currencies_updated_at(); 