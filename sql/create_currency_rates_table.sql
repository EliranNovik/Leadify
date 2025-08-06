-- Create currency_rates table
CREATE TABLE IF NOT EXISTS currency_rates (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    
    -- Basic Information
    currency_symbol VARCHAR(10) NOT NULL, -- e.g., '£', '$', '€', '₪'
    currency_code VARCHAR(3) NOT NULL,    -- ISO 4217 code, e.g., 'GBP', 'USD', 'EUR', 'ILS'
    rate_value NUMERIC(10, 5) NOT NULL,   -- The exchange rate value
    effective_date TIMESTAMP WITH TIME ZONE NOT NULL, -- Date and time the rate became effective
    
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
ALTER TABLE currency_rates ENABLE ROW LEVEL SECURITY;

-- Policy for users to view currency_rates
CREATE POLICY "Users can view currency_rates" ON currency_rates
    FOR SELECT USING (true);

-- Policy for authenticated users to insert currency_rates
CREATE POLICY "Authenticated users can insert currency_rates" ON currency_rates
    FOR INSERT WITH CHECK (auth.uid() IS NOT NULL);

-- Policy for authenticated users to update currency_rates
CREATE POLICY "Authenticated users can update currency_rates" ON currency_rates
    FOR UPDATE USING (auth.uid() IS NOT NULL);

-- Policy for authenticated users to delete currency_rates
CREATE POLICY "Authenticated users can delete currency_rates" ON currency_rates
    FOR DELETE USING (auth.uid() IS NOT NULL);

-- Create indexes for better performance
CREATE INDEX idx_currency_rates_currency_symbol ON currency_rates(currency_symbol);
CREATE INDEX idx_currency_rates_currency_code ON currency_rates(currency_code);
CREATE INDEX idx_currency_rates_effective_date ON currency_rates(effective_date);
CREATE INDEX idx_currency_rates_firm_id ON currency_rates(firm_id);
CREATE INDEX idx_currency_rates_is_active ON currency_rates(is_active);
CREATE INDEX idx_currency_rates_order_value ON currency_rates(order_value);

-- Insert currency rates data from screenshots
INSERT INTO currency_rates (currency_symbol, currency_code, rate_value, effective_date, is_active) VALUES
    ('£', 'GBP', 4.5766, '2025-08-06 06:30:00+00', TRUE),
    ('$', 'USD', 3.4470, '2025-08-06 06:30:00+00', TRUE),
    ('€', 'EUR', 3.9778, '2025-08-06 06:30:00+00', TRUE);

-- Create updated_at trigger
CREATE OR REPLACE FUNCTION update_currency_rates_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER update_currency_rates_updated_at
    BEFORE UPDATE ON currency_rates
    FOR EACH ROW
    EXECUTE FUNCTION update_currency_rates_updated_at(); 