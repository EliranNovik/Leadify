-- Create email_templates table
CREATE TABLE IF NOT EXISTS email_templates (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    
    -- Basic Information
    name VARCHAR(255) NOT NULL,
    language VARCHAR(10) NOT NULL CHECK (language IN ('EN', 'HE')),
    category VARCHAR(255) DEFAULT '---',
    
    -- Content
    content TEXT, -- Stores the HTML or rich text content of the email
    
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
ALTER TABLE email_templates ENABLE ROW LEVEL SECURITY;

-- Policy for users to view email templates
CREATE POLICY "Users can view email templates" ON email_templates
    FOR SELECT USING (true);

-- Policy for authenticated users to insert email templates
CREATE POLICY "Authenticated users can insert email templates" ON email_templates
    FOR INSERT WITH CHECK (auth.uid() IS NOT NULL);

-- Policy for authenticated users to update email templates
CREATE POLICY "Authenticated users can update email templates" ON email_templates
    FOR UPDATE USING (auth.uid() IS NOT NULL);

-- Policy for authenticated users to delete email templates
CREATE POLICY "Authenticated users can delete email templates" ON email_templates
    FOR DELETE USING (auth.uid() IS NOT NULL);

-- Create indexes for better performance
CREATE INDEX idx_email_templates_name ON email_templates(name);
CREATE INDEX idx_email_templates_language ON email_templates(language);
CREATE INDEX idx_email_templates_category ON email_templates(category);
CREATE INDEX idx_email_templates_is_active ON email_templates(is_active);
CREATE INDEX idx_email_templates_firm_id ON email_templates(firm_id);

-- Create updated_at trigger
CREATE OR REPLACE FUNCTION update_email_templates_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER update_email_templates_updated_at
    BEFORE UPDATE ON email_templates
    FOR EACH ROW
    EXECUTE FUNCTION update_email_templates_updated_at(); 