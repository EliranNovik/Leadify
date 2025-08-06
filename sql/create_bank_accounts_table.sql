-- Create bank_accounts table
CREATE TABLE IF NOT EXISTS bank_accounts (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    
    -- Basic Information
    name VARCHAR(255) NOT NULL, -- Bank name (e.g., "Hopoalim", "Mizrahi-Tefahot")
    
    -- Account Details
    account_name VARCHAR(255), -- Account holder name (e.g., "Adv. Michael Decker", "Law Office Michael Decker")
    account_number VARCHAR(50), -- Account number
    bank_code VARCHAR(10), -- Bank code (e.g., "12", "20")
    branch_number VARCHAR(10), -- Branch number
    branch_name VARCHAR(100), -- Branch name/code (e.g., "782", "517")
    branch_address TEXT, -- Full branch address
    
    -- International Banking
    swift_code VARCHAR(20), -- SWIFT/BIC code
    iban VARCHAR(50), -- IBAN number
    
    -- Contact Information
    bank_phone VARCHAR(50), -- Bank phone number
    
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
ALTER TABLE bank_accounts ENABLE ROW LEVEL SECURITY;

-- Policy for users to view bank_accounts
CREATE POLICY "Users can view bank_accounts" ON bank_accounts
    FOR SELECT USING (true);

-- Policy for authenticated users to insert bank_accounts
CREATE POLICY "Authenticated users can insert bank_accounts" ON bank_accounts
    FOR INSERT WITH CHECK (auth.uid() IS NOT NULL);

-- Policy for authenticated users to update bank_accounts
CREATE POLICY "Authenticated users can update bank_accounts" ON bank_accounts
    FOR UPDATE USING (auth.uid() IS NOT NULL);

-- Policy for authenticated users to delete bank_accounts
CREATE POLICY "Authenticated users can delete bank_accounts" ON bank_accounts
    FOR DELETE USING (auth.uid() IS NOT NULL);

-- Create indexes for better performance
CREATE INDEX idx_bank_accounts_name ON bank_accounts(name);
CREATE INDEX idx_bank_accounts_firm_id ON bank_accounts(firm_id);
CREATE INDEX idx_bank_accounts_is_active ON bank_accounts(is_active);
CREATE INDEX idx_bank_accounts_order_value ON bank_accounts(order_value);

-- Insert bank accounts data from screenshots
INSERT INTO bank_accounts (name, account_name, account_number, bank_code, branch_number, branch_name, branch_address, swift_code, iban, bank_phone, order_value, is_active) VALUES
    ('Hopoalim', 'Adv. Michael Decker', '3444445', '12', '782', '782', 'Rehavia, 38 Azza St., Jerusalem', 'POALILIT', 'IL100127820000000344445', '+972-2-569854', 1, TRUE),
    ('Mizrahi-Tefahot', 'Law Office Michael Decker', '378666', '20', '20', '517', 'Talpiot, 8 Hatnufa St., Jerusalem', 'MIZBILIT', 'IL50205170000000378666', '+972-76-804-1170', 2, TRUE);

-- Create updated_at trigger
CREATE OR REPLACE FUNCTION update_bank_accounts_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER update_bank_accounts_updated_at
    BEFORE UPDATE ON bank_accounts
    FOR EACH ROW
    EXECUTE FUNCTION update_bank_accounts_updated_at(); 