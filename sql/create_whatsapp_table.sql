-- Create whatsapp_messages table
CREATE TABLE IF NOT EXISTS whatsapp_messages (
    id SERIAL PRIMARY KEY,
    lead_id UUID REFERENCES leads(id) ON DELETE CASCADE,
    sender_id UUID REFERENCES users(id),
    sender_name TEXT,
    direction TEXT CHECK (direction IN ('in', 'out')) NOT NULL,
    message TEXT NOT NULL,
    sent_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    status TEXT DEFAULT 'sent',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Add indexes for better query performance
CREATE INDEX IF NOT EXISTS idx_whatsapp_lead_id ON whatsapp_messages(lead_id);
CREATE INDEX IF NOT EXISTS idx_whatsapp_sender_id ON whatsapp_messages(sender_id);
CREATE INDEX IF NOT EXISTS idx_whatsapp_sent_at ON whatsapp_messages(sent_at);

-- Add comments for documentation
COMMENT ON TABLE whatsapp_messages IS 'Stores WhatsApp messages related to leads';
COMMENT ON COLUMN whatsapp_messages.id IS 'Primary key for the WhatsApp messages table';
COMMENT ON COLUMN whatsapp_messages.lead_id IS 'Reference to the leads table (UUID)';
COMMENT ON COLUMN whatsapp_messages.sender_id IS 'Reference to the users table (UUID)';
COMMENT ON COLUMN whatsapp_messages.sender_name IS 'Name of the sender';
COMMENT ON COLUMN whatsapp_messages.direction IS 'Message direction: in (from client) or out (from employee)';
COMMENT ON COLUMN whatsapp_messages.message IS 'Content of the WhatsApp message';
COMMENT ON COLUMN whatsapp_messages.sent_at IS 'Timestamp when the message was sent';
COMMENT ON COLUMN whatsapp_messages.status IS 'Status of the message (sent, delivered, read, etc.)';
COMMENT ON COLUMN whatsapp_messages.created_at IS 'When the message was created'; 