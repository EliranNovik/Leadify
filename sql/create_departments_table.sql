-- Create departments table
CREATE TABLE IF NOT EXISTS departments (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    lead_id UUID REFERENCES leads(id), -- Relationship to leads table
    name VARCHAR(255) NOT NULL,
    is_important BOOLEAN DEFAULT false,
    fixed_monthly_cost DECIMAL(15,2) DEFAULT 0,
    marginal_cost_percentage DECIMAL(5,2) DEFAULT 0,
    min_monthly_sales_target DECIMAL(15,2) DEFAULT 0,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    created_by UUID REFERENCES users(id),
    updated_by UUID REFERENCES users(id)
);

-- Add RLS policies
ALTER TABLE departments ENABLE ROW LEVEL SECURITY;

-- Policy for users to view departments
CREATE POLICY "Users can view departments" ON departments
    FOR SELECT USING (true);

-- Policy for users to insert departments (admin only)
CREATE POLICY "Users can insert departments" ON departments
    FOR INSERT WITH CHECK (auth.role() = 'authenticated');

-- Policy for users to update departments (admin only)
CREATE POLICY "Users can update departments" ON departments
    FOR UPDATE USING (auth.role() = 'authenticated');

-- Policy for users to delete departments (admin only)
CREATE POLICY "Users can delete departments" ON departments
    FOR DELETE USING (auth.role() = 'authenticated');

-- Insert all departments from the image
-- Note: firm_id is set to NULL by default. You can update this later when you have the firms table set up.
INSERT INTO departments (name, is_important) VALUES
    ('Commercial & Civil', true),
    ('Damages', false),
    ('Portugal', false),
    ('Administration', false),
    ('Customer service', false),
    ('USA Immigration - Sales', false),
    ('Immigration to Israel - Sales', false),
    ('Poland - Sales', false),
    ('Austria and Germany - Sales', false),
    ('Marketing', false),
    ('Project management', false),
    ('Finance', false),
    ('Small cases', true),
    ('Commercial - Sales', false),
    ('USA - Immigration', true),
    ('Immigration to Israel', true),
    ('Poland', true),
    ('Austria and Germany', true),
    ('General', true);

-- Create updated_at trigger
CREATE OR REPLACE FUNCTION update_departments_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER update_departments_updated_at
    BEFORE UPDATE ON departments
    FOR EACH ROW
    EXECUTE FUNCTION update_departments_updated_at();

-- Create index for better performance
CREATE INDEX idx_departments_lead_id ON departments(lead_id);
CREATE INDEX idx_departments_is_important ON departments(is_important);
CREATE INDEX idx_departments_name ON departments(name); 