-- Create whatsapp_numbers table
CREATE TABLE IF NOT EXISTS whatsapp_numbers (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    
    -- Basic Information
    name VARCHAR(255) NOT NULL, -- Unique identifier (e.g., "default", "mike")
    title VARCHAR(255) NOT NULL, -- Display title (e.g., "default", "mike")
    display_title VARCHAR(255), -- Optional user-friendly display title
    
    -- WhatsApp Configuration
    phone_number VARCHAR(50) NOT NULL, -- WhatsApp phone number (e.g., "972503489649")
    api_key TEXT NOT NULL, -- WhatsApp Business API key
    namespace VARCHAR(255) NOT NULL, -- WhatsApp Business Account namespace
    
    -- Access Control
    allowed_employee_ids UUID[], -- Array of employee UUIDs who can use this number
    allowed_employee_names TEXT[], -- Array of employee names (alternative to UUIDs)
    
    -- Organization
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
ALTER TABLE whatsapp_numbers ENABLE ROW LEVEL SECURITY;

-- Policy for users to view whatsapp_numbers
CREATE POLICY "Users can view whatsapp_numbers" ON whatsapp_numbers
    FOR SELECT USING (true);

-- Policy for authenticated users to insert whatsapp_numbers
CREATE POLICY "Authenticated users can insert whatsapp_numbers" ON whatsapp_numbers
    FOR INSERT WITH CHECK (auth.uid() IS NOT NULL);

-- Policy for authenticated users to update whatsapp_numbers
CREATE POLICY "Authenticated users can update whatsapp_numbers" ON whatsapp_numbers
    FOR UPDATE USING (auth.uid() IS NOT NULL);

-- Policy for authenticated users to delete whatsapp_numbers
CREATE POLICY "Authenticated users can delete whatsapp_numbers" ON whatsapp_numbers
    FOR DELETE USING (auth.uid() IS NOT NULL);

-- Create indexes for better performance
CREATE INDEX idx_whatsapp_numbers_name ON whatsapp_numbers(name);
CREATE INDEX idx_whatsapp_numbers_title ON whatsapp_numbers(title);
CREATE INDEX idx_whatsapp_numbers_phone_number ON whatsapp_numbers(phone_number);
CREATE INDEX idx_whatsapp_numbers_firm_id ON whatsapp_numbers(firm_id);
CREATE INDEX idx_whatsapp_numbers_is_active ON whatsapp_numbers(is_active);

-- Insert whatsapp numbers data from screenshots
INSERT INTO whatsapp_numbers (name, title, display_title, phone_number, api_key, namespace, allowed_employee_ids, allowed_employee_names, is_active) VALUES
    -- Default WhatsApp number
    ('default', 'default', NULL, '972503489649', 'vo00nbg4mNvDMmK5J0Xn0asAAK', '445b1f0f_3c24_4d76_9fca_d0be0f371117', 
     NULL, NULL, TRUE),
    
    -- Mike's WhatsApp number
    ('mike', 'mike', NULL, '972512469500', 'qpyi6Fid4FpV2BiqfoZS1sRAAK', '7e7a3e80_7a8a_40ca_8100_a3a9d1c18018',
     NULL, NULL, TRUE);

-- Create updated_at trigger
CREATE OR REPLACE FUNCTION update_whatsapp_numbers_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER update_whatsapp_numbers_updated_at
    BEFORE UPDATE ON whatsapp_numbers
    FOR EACH ROW
    EXECUTE FUNCTION update_whatsapp_numbers_updated_at(); 