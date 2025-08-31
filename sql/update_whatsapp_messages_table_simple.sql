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

-- Enable RLS (optional - you can disable this if you don't need it)
-- ALTER TABLE whatsapp_messages ENABLE ROW LEVEL SECURITY;

-- Simple RLS policy that allows all authenticated users to access whatsapp_messages
-- You can uncomment and modify these if you need RLS
/*
CREATE POLICY "Authenticated users can access whatsapp messages" ON whatsapp_messages
    FOR ALL USING (auth.role() = 'authenticated');
*/

-- Grant permissions
GRANT SELECT, INSERT, UPDATE ON whatsapp_messages TO authenticated;
GRANT SELECT, INSERT, UPDATE ON whatsapp_messages TO anon; 