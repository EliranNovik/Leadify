-- Add template_id column to whatsapp_messages table to store the database template ID
-- This allows proper matching of templates by ID instead of name (which can be duplicated in different languages)

ALTER TABLE whatsapp_messages 
ADD COLUMN IF NOT EXISTS template_id BIGINT REFERENCES whatsapp_whatsapptemplate(id) ON DELETE SET NULL;

-- Add index for better performance when querying by template_id
CREATE INDEX IF NOT EXISTS idx_whatsapp_messages_template_id ON whatsapp_messages(template_id);

-- Add comment for documentation
COMMENT ON COLUMN whatsapp_messages.template_id IS 'Reference to whatsapp_whatsapptemplate.id - used to match the exact template that was sent, avoiding name collisions between languages';

