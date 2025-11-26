-- Update foreign key constraint to point to the new whatsapp_templates table

-- Drop old foreign key if it exists
ALTER TABLE whatsapp_messages 
DROP CONSTRAINT IF EXISTS whatsapp_messages_template_id_fkey;

-- Add new foreign key pointing to whatsapp_templates
ALTER TABLE whatsapp_messages 
ADD CONSTRAINT whatsapp_messages_template_id_fkey 
FOREIGN KEY (template_id) 
REFERENCES whatsapp_templates(id) 
ON DELETE SET NULL;

-- Verify the constraint
SELECT 
    conname AS constraint_name,
    conrelid::regclass AS table_name,
    confrelid::regclass AS referenced_table
FROM pg_constraint
WHERE conname = 'whatsapp_messages_template_id_fkey';

