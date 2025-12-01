-- Create company_signature_templates table
CREATE TABLE IF NOT EXISTS company_signature_templates (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    
    -- Template Information
    name VARCHAR(255) NOT NULL,
    description TEXT,
    
    -- Template Structure (stored as JSONB)
    -- Structure:
    -- {
    --   "namePosition": { "text": "{{name}} - {{position}}" },
    --   "twoImages": [{ "url": "...", "alt": "..." }, { "url": "...", "alt": "..." }],
    --   "phone": { "text": "{{phone}}" },
    --   "address": { "text": "..." },
    --   "website": { "text": "..." },
    --   "singleImage": { "url": "...", "alt": "..." },
    --   "threeImages": [{ "url": "...", "alt": "..." }, { "url": "...", "alt": "..." }, { "url": "...", "alt": "..." }],
    --   "finalImage": { "url": "...", "alt": "..." }
    -- }
    template_data JSONB NOT NULL DEFAULT '{}',
    
    -- User association (for user-specific templates)
    user_id UUID REFERENCES users(id) ON DELETE CASCADE,
    
    -- Status
    is_active BOOLEAN DEFAULT true NOT NULL,
    is_default BOOLEAN DEFAULT false NOT NULL,
    
    -- Timestamps
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    created_by UUID REFERENCES auth.users(id),
    updated_by UUID REFERENCES auth.users(id)
);

-- Add user_id column if it doesn't exist (for existing tables)
DO $$ 
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'company_signature_templates' 
        AND column_name = 'user_id'
    ) THEN
        ALTER TABLE company_signature_templates 
        ADD COLUMN user_id UUID REFERENCES users(id) ON DELETE CASCADE;
    END IF;
END $$;

-- Add RLS policies
ALTER TABLE company_signature_templates ENABLE ROW LEVEL SECURITY;

-- Drop existing policies if they exist (for idempotency)
DROP POLICY IF EXISTS "Users can view company signature templates" ON company_signature_templates;
DROP POLICY IF EXISTS "Authenticated users can insert company signature templates" ON company_signature_templates;
DROP POLICY IF EXISTS "Authenticated users can update company signature templates" ON company_signature_templates;
DROP POLICY IF EXISTS "Authenticated users can delete company signature templates" ON company_signature_templates;

-- Policy for users to view company signature templates
CREATE POLICY "Users can view company signature templates" ON company_signature_templates
    FOR SELECT USING (true);

-- Policy for authenticated users to insert company signature templates
CREATE POLICY "Authenticated users can insert company signature templates" ON company_signature_templates
    FOR INSERT WITH CHECK (auth.uid() IS NOT NULL);

-- Policy for authenticated users to update company signature templates
CREATE POLICY "Authenticated users can update company signature templates" ON company_signature_templates
    FOR UPDATE USING (auth.uid() IS NOT NULL);

-- Policy for authenticated users to delete company signature templates
CREATE POLICY "Authenticated users can delete company signature templates" ON company_signature_templates
    FOR DELETE USING (auth.uid() IS NOT NULL);

-- Create indexes for better performance (IF NOT EXISTS for idempotency)
CREATE INDEX IF NOT EXISTS idx_company_signature_templates_name ON company_signature_templates(name);
CREATE INDEX IF NOT EXISTS idx_company_signature_templates_is_active ON company_signature_templates(is_active);
CREATE INDEX IF NOT EXISTS idx_company_signature_templates_is_default ON company_signature_templates(is_default);
CREATE INDEX IF NOT EXISTS idx_company_signature_templates_user_id ON company_signature_templates(user_id);
CREATE INDEX IF NOT EXISTS idx_company_signature_templates_template_data ON company_signature_templates USING GIN (template_data);

-- Create updated_at trigger
CREATE OR REPLACE FUNCTION update_company_signature_templates_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS company_signature_templates_updated_at ON company_signature_templates;
CREATE TRIGGER company_signature_templates_updated_at
    BEFORE UPDATE ON company_signature_templates
    FOR EACH ROW
    EXECUTE FUNCTION update_company_signature_templates_updated_at();

-- Add comment for documentation
COMMENT ON TABLE company_signature_templates IS 'Company-wide email signature templates that can be used by all employees';
COMMENT ON COLUMN company_signature_templates.template_data IS 'JSONB structure containing the signature template with placeholders for name/position/phone ({{name}}, {{position}}, {{phone}}) and image URLs';

