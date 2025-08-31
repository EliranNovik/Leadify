-- Create double_leads table to store potential duplicate leads
CREATE TABLE IF NOT EXISTS double_leads (
    id SERIAL PRIMARY KEY,
    new_lead_data JSONB NOT NULL,
    existing_lead_id UUID REFERENCES leads(id) ON DELETE CASCADE,
    duplicate_fields TEXT[] NOT NULL, -- Array of fields that match (email, phone, mobile, name)
    status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'accepted', 'rejected', 'merged')),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    resolved_at TIMESTAMP WITH TIME ZONE,
    resolved_by UUID REFERENCES users(id),
    resolution_notes TEXT
);

-- Add comments to document the table
COMMENT ON TABLE double_leads IS 'Stores potential duplicate leads detected by the webhook';
COMMENT ON COLUMN double_leads.new_lead_data IS 'JSON data of the new lead that was detected as duplicate';
COMMENT ON COLUMN double_leads.existing_lead_id IS 'ID of the existing lead that matches the new lead';
COMMENT ON COLUMN double_leads.duplicate_fields IS 'Array of field names that caused the duplicate detection';
COMMENT ON COLUMN double_leads.status IS 'Current status of the duplicate lead (pending, accepted, rejected, merged)';
COMMENT ON COLUMN double_leads.resolved_by IS 'User ID who resolved the duplicate';

-- Create indexes for better performance
CREATE INDEX IF NOT EXISTS idx_double_leads_status ON double_leads(status);
CREATE INDEX IF NOT EXISTS idx_double_leads_created_at ON double_leads(created_at);
CREATE INDEX IF NOT EXISTS idx_double_leads_existing_lead_id ON double_leads(existing_lead_id);

-- Enable Row Level Security
ALTER TABLE double_leads ENABLE ROW LEVEL SECURITY;

-- Create RLS policies
CREATE POLICY "Users can view double leads" ON double_leads
    FOR SELECT USING (true);

CREATE POLICY "Users can insert double leads" ON double_leads
    FOR INSERT WITH CHECK (true);

CREATE POLICY "Users can update double leads" ON double_leads
    FOR UPDATE USING (true);

CREATE POLICY "Users can delete double leads" ON double_leads
    FOR DELETE USING (true);
