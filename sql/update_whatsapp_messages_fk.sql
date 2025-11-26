-- Update foreign key constraint in whatsapp_messages to point to new whatsapp_templates table

-- Drop old foreign key constraint if it exists
ALTER TABLE whatsapp_messages 
DROP CONSTRAINT IF EXISTS whatsapp_messages_template_id_fkey;

-- Add new foreign key constraint pointing to whatsapp_templates
ALTER TABLE whatsapp_messages 
ADD CONSTRAINT whatsapp_messages_template_id_fkey 
FOREIGN KEY (template_id) 
REFERENCES whatsapp_templates(id) 
ON DELETE SET NULL;

-- Index already exists from previous migration, but verify it
CREATE INDEX IF NOT EXISTS idx_whatsapp_messages_template_id ON whatsapp_messages(template_id);

