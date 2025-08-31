-- Fix whatsapp_messages table schema
-- Drop existing table and recreate with proper structure

-- Drop existing table if it exists
DROP TABLE IF EXISTS whatsapp_messages CASCADE;

-- Create whatsapp_messages table with proper structure
CREATE TABLE whatsapp_messages (
    id SERIAL PRIMARY KEY,
    lead_id UUID REFERENCES leads(id) ON DELETE CASCADE,
    sender_name TEXT NOT NULL,
    direction TEXT NOT NULL CHECK (direction IN ('in', 'out')),
    message TEXT,
    sent_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    message_type VARCHAR(20) DEFAULT 'text' CHECK (message_type IN ('text', 'image', 'document', 'audio', 'video', 'location', 'contact')),
    media_url TEXT,
    media_id VARCHAR(255),
    media_filename VARCHAR(255),
    media_mime_type VARCHAR(100),
    media_size INTEGER,
    caption TEXT,
    whatsapp_message_id VARCHAR(255),
    whatsapp_status VARCHAR(50) DEFAULT 'sent' CHECK (whatsapp_status IN ('pending', 'sent', 'delivered', 'read', 'failed')),
    whatsapp_timestamp TIMESTAMP WITH TIME ZONE,
    error_message TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Add indexes for better performance
CREATE INDEX idx_whatsapp_messages_lead_id ON whatsapp_messages(lead_id);
CREATE INDEX idx_whatsapp_messages_sent_at ON whatsapp_messages(sent_at);
CREATE INDEX idx_whatsapp_messages_whatsapp_id ON whatsapp_messages(whatsapp_message_id);
CREATE INDEX idx_whatsapp_messages_status ON whatsapp_messages(whatsapp_status);
CREATE INDEX idx_whatsapp_messages_direction ON whatsapp_messages(direction);

-- Enable RLS
ALTER TABLE whatsapp_messages ENABLE ROW LEVEL SECURITY;

-- Simple RLS policy - allow all authenticated users to access whatsapp messages
CREATE POLICY "Authenticated users can access whatsapp messages" ON whatsapp_messages 
    FOR ALL USING (auth.role() = 'authenticated');

-- Grant permissions
GRANT SELECT, INSERT, UPDATE ON whatsapp_messages TO authenticated;
GRANT SELECT, INSERT, UPDATE ON whatsapp_messages TO anon;

-- Create trigger to update updated_at timestamp
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ language 'plpgsql';

CREATE TRIGGER update_whatsapp_messages_updated_at 
    BEFORE UPDATE ON whatsapp_messages 
    FOR EACH ROW 
    EXECUTE FUNCTION update_updated_at_column(); 