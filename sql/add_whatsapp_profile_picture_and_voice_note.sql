-- Add profile picture URL and voice note flag to whatsapp_messages table
-- This allows storing WhatsApp profile pictures and distinguishing voice notes from regular audio

-- Add profile_picture_url column to store WhatsApp profile picture URLs
ALTER TABLE whatsapp_messages 
ADD COLUMN IF NOT EXISTS profile_picture_url TEXT;

-- Add voice_note boolean flag to distinguish voice messages from regular audio
ALTER TABLE whatsapp_messages 
ADD COLUMN IF NOT EXISTS voice_note BOOLEAN DEFAULT FALSE;

-- Add index for profile picture lookups (optional, for performance)
CREATE INDEX IF NOT EXISTS idx_whatsapp_messages_profile_picture ON whatsapp_messages(profile_picture_url) WHERE profile_picture_url IS NOT NULL;

-- Add index for voice note queries
CREATE INDEX IF NOT EXISTS idx_whatsapp_messages_voice_note ON whatsapp_messages(voice_note) WHERE voice_note = TRUE;

-- Also add profile_picture_url to leads table to store profile pictures for contacts
ALTER TABLE leads 
ADD COLUMN IF NOT EXISTS whatsapp_profile_picture_url TEXT;

-- Add profile_picture_url to leads_contact table as well
ALTER TABLE leads_contact 
ADD COLUMN IF NOT EXISTS whatsapp_profile_picture_url TEXT;

-- Add indexes for profile picture lookups
CREATE INDEX IF NOT EXISTS idx_leads_whatsapp_profile_picture ON leads(whatsapp_profile_picture_url) WHERE whatsapp_profile_picture_url IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_leads_contact_whatsapp_profile_picture ON leads_contact(whatsapp_profile_picture_url) WHERE whatsapp_profile_picture_url IS NOT NULL;

