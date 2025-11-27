-- Add missing columns to whatsapp_messages table
-- This migration adds all columns that are used by the backend but might be missing from the database

-- Add contact_id column to store which contact the message is from/to
ALTER TABLE whatsapp_messages 
ADD COLUMN IF NOT EXISTS contact_id INTEGER REFERENCES leads_contact(id) ON DELETE SET NULL;

-- Add phone_number column to store the phone number for messages from unknown leads
ALTER TABLE whatsapp_messages 
ADD COLUMN IF NOT EXISTS phone_number TEXT;

-- Add legacy_id column to store legacy lead IDs (from leads_lead table)
ALTER TABLE whatsapp_messages 
ADD COLUMN IF NOT EXISTS legacy_id BIGINT REFERENCES leads_lead(id) ON DELETE SET NULL;

-- Add sender_id column to reference the user who sent the message
ALTER TABLE whatsapp_messages 
ADD COLUMN IF NOT EXISTS sender_id UUID REFERENCES users(id) ON DELETE SET NULL;

-- Add template_id column (might already exist, but ensure it's there)
ALTER TABLE whatsapp_messages 
ADD COLUMN IF NOT EXISTS template_id INTEGER REFERENCES whatsapp_templates_v2(id) ON DELETE SET NULL;

-- Add profile_picture_url column (from add_whatsapp_profile_picture_and_voice_note.sql)
ALTER TABLE whatsapp_messages 
ADD COLUMN IF NOT EXISTS profile_picture_url TEXT;

-- Add voice_note column (from add_whatsapp_profile_picture_and_voice_note.sql)
ALTER TABLE whatsapp_messages 
ADD COLUMN IF NOT EXISTS voice_note BOOLEAN DEFAULT FALSE;

-- Add media_id column (separate from media_url, stores WhatsApp media ID)
ALTER TABLE whatsapp_messages 
ADD COLUMN IF NOT EXISTS media_id VARCHAR(255);

-- Add indexes for better query performance
CREATE INDEX IF NOT EXISTS idx_whatsapp_messages_contact_id ON whatsapp_messages(contact_id) WHERE contact_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_whatsapp_messages_phone_number ON whatsapp_messages(phone_number) WHERE phone_number IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_whatsapp_messages_legacy_id ON whatsapp_messages(legacy_id) WHERE legacy_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_whatsapp_messages_sender_id ON whatsapp_messages(sender_id) WHERE sender_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_whatsapp_messages_template_id ON whatsapp_messages(template_id) WHERE template_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_whatsapp_messages_profile_picture_url ON whatsapp_messages(profile_picture_url) WHERE profile_picture_url IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_whatsapp_messages_voice_note ON whatsapp_messages(voice_note) WHERE voice_note = TRUE;
CREATE INDEX IF NOT EXISTS idx_whatsapp_messages_media_id ON whatsapp_messages(media_id) WHERE media_id IS NOT NULL;

-- Add comments for documentation
COMMENT ON COLUMN whatsapp_messages.contact_id IS 'Reference to leads_contact table - identifies which contact the message is from/to';
COMMENT ON COLUMN whatsapp_messages.phone_number IS 'Phone number from WhatsApp - used for messages from unknown leads';
COMMENT ON COLUMN whatsapp_messages.legacy_id IS 'Reference to leads_lead table for legacy leads';
COMMENT ON COLUMN whatsapp_messages.sender_id IS 'Reference to users table - identifies which user sent the message';
COMMENT ON COLUMN whatsapp_messages.template_id IS 'Reference to whatsapp_templates_v2 table - identifies which template was used';
COMMENT ON COLUMN whatsapp_messages.profile_picture_url IS 'WhatsApp profile picture URL from webhook';
COMMENT ON COLUMN whatsapp_messages.voice_note IS 'True if this is a voice note (not regular audio)';
COMMENT ON COLUMN whatsapp_messages.media_id IS 'WhatsApp media ID (separate from media_url which may store the same or different value)';

