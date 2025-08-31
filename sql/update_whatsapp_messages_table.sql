-- Update whatsapp_messages table to support images, attachments, and WhatsApp-specific fields
-- Add new columns for WhatsApp integration

-- Add new columns for media support
ALTER TABLE whatsapp_messages 
ADD COLUMN IF NOT EXISTS message_type VARCHAR(20) DEFAULT 'text' CHECK (message_type IN ('text', 'image', 'document', 'audio', 'video', 'location', 'contact')),
ADD COLUMN IF NOT EXISTS media_url TEXT,
ADD COLUMN IF NOT EXISTS media_id VARCHAR(255),
ADD COLUMN IF NOT EXISTS media_filename VARCHAR(255),
ADD COLUMN IF NOT EXISTS media_mime_type VARCHAR(100),
ADD COLUMN IF NOT EXISTS media_size INTEGER,
ADD COLUMN IF NOT EXISTS caption TEXT,
ADD COLUMN IF NOT EXISTS whatsapp_message_id VARCHAR(255),
ADD COLUMN IF NOT EXISTS whatsapp_status VARCHAR(50) DEFAULT 'sent' CHECK (whatsapp_status IN ('pending', 'sent', 'delivered', 'read', 'failed')),
ADD COLUMN IF NOT EXISTS whatsapp_timestamp TIMESTAMP WITH TIME ZONE,
ADD COLUMN IF NOT EXISTS error_message TEXT;

-- Add indexes for better performance
CREATE INDEX IF NOT EXISTS idx_whatsapp_messages_lead_id ON whatsapp_messages(lead_id);
CREATE INDEX IF NOT EXISTS idx_whatsapp_messages_sent_at ON whatsapp_messages(sent_at);
CREATE INDEX IF NOT EXISTS idx_whatsapp_messages_whatsapp_id ON whatsapp_messages(whatsapp_message_id);
CREATE INDEX IF NOT EXISTS idx_whatsapp_messages_status ON whatsapp_messages(whatsapp_status);

-- Add RLS policies for whatsapp_messages
ALTER TABLE whatsapp_messages ENABLE ROW LEVEL SECURITY;

-- Policy for authenticated users to read whatsapp messages
CREATE POLICY "Users can read whatsapp messages" ON whatsapp_messages
    FOR SELECT USING (auth.uid() IN (
        SELECT auth_id FROM users WHERE email = (
            SELECT closer FROM leads WHERE id = whatsapp_messages.lead_id
        )
    ));

-- Policy for authenticated users to insert whatsapp messages
CREATE POLICY "Users can insert whatsapp messages" ON whatsapp_messages
    FOR INSERT WITH CHECK (auth.uid() IN (
        SELECT auth_id FROM users WHERE email = (
            SELECT closer FROM leads WHERE id = whatsapp_messages.lead_id
        )
    ));

-- Policy for authenticated users to update whatsapp messages
CREATE POLICY "Users can update whatsapp messages" ON whatsapp_messages
    FOR UPDATE USING (auth.uid() IN (
        SELECT auth_id FROM users WHERE email = (
            SELECT closer FROM leads WHERE id = whatsapp_messages.lead_id
        )
    ));

-- Grant permissions
GRANT SELECT, INSERT, UPDATE ON whatsapp_messages TO authenticated;
GRANT SELECT, INSERT, UPDATE ON whatsapp_messages TO anon; 