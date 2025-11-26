-- Update foreign key constraint to point to the new whatsapp_templates_v2 table

-- Drop old foreign key if it exists
ALTER TABLE whatsapp_messages 
DROP CONSTRAINT IF EXISTS whatsapp_messages_template_id_fkey;

-- Add new foreign key pointing to whatsapp_templates_v2
ALTER TABLE whatsapp_messages 
ADD CONSTRAINT whatsapp_messages_template_id_fkey 
FOREIGN KEY (template_id) 
REFERENCES whatsapp_templates_v2(id) 
ON DELETE SET NULL;

-- Create index if it doesn't exist
CREATE INDEX IF NOT EXISTS idx_whatsapp_messages_template_id ON whatsapp_messages(template_id);

