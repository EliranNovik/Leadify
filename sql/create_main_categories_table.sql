-- Create main_categories table
CREATE TABLE IF NOT EXISTS main_categories (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    
    -- Basic Information
    name VARCHAR(255) NOT NULL UNIQUE,
    order_value INTEGER DEFAULT 0,
    
    -- Meeting Limits
    max_daily_meetings INTEGER,
    max_hourly_meetings INTEGER,
    
    -- Status Flags
    is_important BOOLEAN DEFAULT false NOT NULL,
    is_active BOOLEAN DEFAULT true NOT NULL,
    
    -- Relationships
    firm_id UUID, -- Can be linked to firms table later if needed
    department_id UUID REFERENCES departments(id), -- Link to departments table
    
    -- Timestamps
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    created_by UUID REFERENCES auth.users(id),
    updated_by UUID REFERENCES auth.users(id)
);

-- Add RLS policies
ALTER TABLE main_categories ENABLE ROW LEVEL SECURITY;

-- Policy for users to view main_categories
CREATE POLICY "Users can view main_categories" ON main_categories
    FOR SELECT USING (true);

-- Policy for authenticated users to insert main_categories
CREATE POLICY "Authenticated users can insert main_categories" ON main_categories
    FOR INSERT WITH CHECK (auth.uid() IS NOT NULL);

-- Policy for authenticated users to update main_categories
CREATE POLICY "Authenticated users can update main_categories" ON main_categories
    FOR UPDATE USING (auth.uid() IS NOT NULL);

-- Policy for authenticated users to delete main_categories
CREATE POLICY "Authenticated users can delete main_categories" ON main_categories
    FOR DELETE USING (auth.uid() IS NOT NULL);

-- Create indexes for better performance
CREATE INDEX idx_main_categories_name ON main_categories(name);
CREATE INDEX idx_main_categories_order_value ON main_categories(order_value);
CREATE INDEX idx_main_categories_is_active ON main_categories(is_active);
CREATE INDEX idx_main_categories_is_important ON main_categories(is_important);
CREATE INDEX idx_main_categories_firm_id ON main_categories(firm_id);
CREATE INDEX idx_main_categories_department_id ON main_categories(department_id);

-- Insert main categories data from the first screenshot
INSERT INTO main_categories (name, order_value, is_important, is_active) VALUES
    ('Poland', 1, FALSE, FALSE),
    ('Portugal', 2, FALSE, FALSE),
    ('Austria', 3, TRUE, TRUE),
    ('Germany', 4, TRUE, TRUE),
    ('Immigration Israel', 5, TRUE, TRUE),
    ('USA', 6, TRUE, TRUE),
    ('Damages', 7, FALSE, TRUE),
    ('Commer/Civil/Adm/Fam', 8, TRUE, TRUE),
    ('Small without meetin', 9, TRUE, TRUE),
    ('Other Citizenships', 10, FALSE, FALSE),
    ('Eligibility Checker', 11, TRUE, TRUE),
    ('German\Austrian', 12, TRUE, TRUE),
    ('other', 13, FALSE, TRUE);

-- Create updated_at trigger
CREATE OR REPLACE FUNCTION update_main_categories_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER update_main_categories_updated_at
    BEFORE UPDATE ON main_categories
    FOR EACH ROW
    EXECUTE FUNCTION update_main_categories_updated_at(); 