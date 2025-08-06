-- Create employees table
CREATE TABLE IF NOT EXISTS employees (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    
    -- Basic Information
    display_name VARCHAR(255) NOT NULL,
    official_name VARCHAR(255) NOT NULL,
    
    -- Relationships
    user_id UUID REFERENCES auth.users(id), -- Link to auth user
    department_id UUID REFERENCES departments(id),
    lead_id UUID REFERENCES leads(id),
    
    -- Contact Information
    mobile VARCHAR(50),
    phone VARCHAR(50),
    phone_extension VARCHAR(20),
    mobile_extension VARCHAR(20),
    last_call_from VARCHAR(50),
    
    -- Meeting Information
    meeting_link TEXT,
    
    -- Photo
    photo_url TEXT,
    
    -- Boolean Permissions/Roles
    is_manager BOOLEAN DEFAULT false,
    is_lawyer BOOLEAN DEFAULT false,
    is_meeting_scheduler BOOLEAN DEFAULT false,
    is_leads_router BOOLEAN DEFAULT false,
    is_collection_manager BOOLEAN DEFAULT false,
    can_see_reports BOOLEAN DEFAULT false,
    can_decline_price_offers BOOLEAN DEFAULT false,
    is_active BOOLEAN DEFAULT true,
    
    -- Dropdown Selections
    permissions_level VARCHAR(100) DEFAULT 'Access all leads' 
        CHECK (permissions_level IN ('Access all leads', 'Leads limited access (view only)', 'Exclusive leads only')),
    bonuses_role VARCHAR(100) DEFAULT 'One-time bonus (temporary)' 
        CHECK (bonuses_role IN ('One-time bonus (temporary)', 'No bonuses', 'scheduler', 'expert', 'closer')),
    
    -- Multi-select fields (stored as JSON arrays)
    expertees JSONB DEFAULT '[]'::jsonb,
    allowed_sources JSONB DEFAULT '[]'::jsonb,
    preferred_categories JSONB DEFAULT '[]'::jsonb,
    
    -- Order/Priority
    display_order INTEGER DEFAULT 100,
    
    -- Timestamps
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    created_by UUID REFERENCES auth.users(id),
    updated_by UUID REFERENCES auth.users(id)
);

-- Add RLS policies
ALTER TABLE employees ENABLE ROW LEVEL SECURITY;

-- Policy for users to view employees
CREATE POLICY "Users can view employees" ON employees
    FOR SELECT USING (true);

-- Policy for users to insert employees (admin only)
CREATE POLICY "Users can insert employees" ON employees
    FOR INSERT WITH CHECK (auth.role() = 'authenticated');

-- Policy for users to update employees (admin only)
CREATE POLICY "Users can update employees" ON employees
    FOR UPDATE USING (auth.role() = 'authenticated');

-- Policy for users to delete employees (admin only)
CREATE POLICY "Users can delete employees" ON employees
    FOR DELETE USING (auth.role() = 'authenticated');

-- Create updated_at trigger
CREATE OR REPLACE FUNCTION update_employees_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER update_employees_updated_at
    BEFORE UPDATE ON employees
    FOR EACH ROW
    EXECUTE FUNCTION update_employees_updated_at();

-- Create indexes for better performance
CREATE INDEX idx_employees_user_id ON employees(user_id);
CREATE INDEX idx_employees_department_id ON employees(department_id);
CREATE INDEX idx_employees_lead_id ON employees(lead_id);
CREATE INDEX idx_employees_display_name ON employees(display_name);
CREATE INDEX idx_employees_is_active ON employees(is_active);
CREATE INDEX idx_employees_is_manager ON employees(is_manager);
CREATE INDEX idx_employees_is_lawyer ON employees(is_lawyer);
CREATE INDEX idx_employees_can_see_reports ON employees(can_see_reports);

-- Create GIN indexes for JSONB columns
CREATE INDEX idx_employees_expertees ON employees USING GIN (expertees);
CREATE INDEX idx_employees_allowed_sources ON employees USING GIN (allowed_sources);
CREATE INDEX idx_employees_preferred_categories ON employees USING GIN (preferred_categories); 