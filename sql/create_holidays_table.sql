-- Create holidays table
CREATE TABLE IF NOT EXISTS holidays (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    
    -- Basic Information
    name VARCHAR(255) NOT NULL,
    date DATE NOT NULL,
    start_time TIME WITH TIME ZONE,
    
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
ALTER TABLE holidays ENABLE ROW LEVEL SECURITY;

-- Policy for users to view holidays
CREATE POLICY "Users can view holidays" ON holidays
    FOR SELECT USING (true);

-- Policy for authenticated users to insert holidays
CREATE POLICY "Authenticated users can insert holidays" ON holidays
    FOR INSERT WITH CHECK (auth.uid() IS NOT NULL);

-- Policy for authenticated users to update holidays
CREATE POLICY "Authenticated users can update holidays" ON holidays
    FOR UPDATE USING (auth.uid() IS NOT NULL);

-- Policy for authenticated users to delete holidays
CREATE POLICY "Authenticated users can delete holidays" ON holidays
    FOR DELETE USING (auth.uid() IS NOT NULL);

-- Create indexes for better performance
CREATE INDEX idx_holidays_name ON holidays(name);
CREATE INDEX idx_holidays_date ON holidays(date);
CREATE INDEX idx_holidays_is_active ON holidays(is_active);
CREATE INDEX idx_holidays_firm_id ON holidays(firm_id);

-- Insert holiday data from the first screenshot
INSERT INTO holidays (name, date, start_time) VALUES
    ('Independence Day', '2023-04-26', '00:00:00'),
    ('Lecture on Thursday 13:00 - 1400 mandatory', '2023-05-18', '13:00:00'),
    ('Rosh HaShana', '2023-09-14', '00:00:00'),
    ('Rosh HaShana', '2023-09-17', '00:00:00'),
    ('shavuot', '2024-06-11', '00:00:00'),
    ('2024-10 Rosh HaShana eve', '2024-10-02', '00:00:00'),
    ('2024-10 Rosh HaShana day 1', '2024-10-03', '00:00:00'),
    ('2024-10 Sukkot eve', '2024-10-16', '00:00:00'),
    ('2024-10 Sukkot day 1', '2024-10-17', '00:00:00'),
    ('2024-12 Hanukkah day 1 + Christmas (not a day off)', '2024-12-25', '00:00:00');

-- Create updated_at trigger
CREATE OR REPLACE FUNCTION update_holidays_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER update_holidays_updated_at
    BEFORE UPDATE ON holidays
    FOR EACH ROW
    EXECUTE FUNCTION update_holidays_updated_at(); 