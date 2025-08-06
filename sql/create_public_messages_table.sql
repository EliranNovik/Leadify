-- Create public_messages table
CREATE TABLE IF NOT EXISTS public_messages (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    
    -- Basic Information
    title VARCHAR(500), -- Summary/title of the message
    content TEXT NOT NULL,
    order_value INTEGER DEFAULT 0,
    
    -- Display Settings
    display_mode VARCHAR(50) NOT NULL CHECK (display_mode IN ('Scheduling screen only', 'Everywhere')),
    
    -- Date Range
    start_date DATE NOT NULL,
    end_date DATE NOT NULL,
    
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
ALTER TABLE public_messages ENABLE ROW LEVEL SECURITY;

-- Policy for users to view public_messages
CREATE POLICY "Users can view public_messages" ON public_messages
    FOR SELECT USING (true);

-- Policy for authenticated users to insert public_messages
CREATE POLICY "Authenticated users can insert public_messages" ON public_messages
    FOR INSERT WITH CHECK (auth.uid() IS NOT NULL);

-- Policy for authenticated users to update public_messages
CREATE POLICY "Authenticated users can update public_messages" ON public_messages
    FOR UPDATE USING (auth.uid() IS NOT NULL);

-- Policy for authenticated users to delete public_messages
CREATE POLICY "Authenticated users can delete public_messages" ON public_messages
    FOR DELETE USING (auth.uid() IS NOT NULL);

-- Create indexes for better performance
CREATE INDEX idx_public_messages_title ON public_messages(title);
CREATE INDEX idx_public_messages_display_mode ON public_messages(display_mode);
CREATE INDEX idx_public_messages_start_date ON public_messages(start_date);
CREATE INDEX idx_public_messages_end_date ON public_messages(end_date);
CREATE INDEX idx_public_messages_order_value ON public_messages(order_value);
CREATE INDEX idx_public_messages_is_active ON public_messages(is_active);
CREATE INDEX idx_public_messages_firm_id ON public_messages(firm_id);

-- Insert public messages data from the first screenshot
INSERT INTO public_messages (content, display_mode, start_date, end_date, order_value) VALUES
    ('Meetings related to Austrian and German citizenship for US clients could be scheduled from 9 AM till 8:30 PM Israel time every half an hour. Better to leave 1 hour gap between.', 'Scheduling screen only', '2025-03-31', '2025-12-31', 1),
    ('לא לקבוע פגישות לכל יום חמישי בין 13 ל-14 בגלל ההרצאה', 'Everywhere', '2025-02-02', '2025-04-01', 2),
    ('שימו לב ב 1.4 אריאל עובד מהבית - לא לקבוע פגישות בנושאי הגירה לישראל מהמשרד בירושלים', 'Everywhere', '2025-03-30', '2025-12-31', 3);

-- Create updated_at trigger
CREATE OR REPLACE FUNCTION update_public_messages_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER update_public_messages_updated_at
    BEFORE UPDATE ON public_messages
    FOR EACH ROW
    EXECUTE FUNCTION update_public_messages_updated_at(); 