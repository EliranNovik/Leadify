-- Migration script to move data from whatsapp_whatsapptemplate to whatsapp_templates
-- This assumes the new table already exists (run create_whatsapp_templates_new.sql first)

-- Step 1: Migrate existing templates from old table to new table
-- Using whatsapp_template_id = number_id (WhatsApp template ID from API)
INSERT INTO whatsapp_templates (whatsapp_template_id, name, language, content, params, active, created_at, updated_at)
SELECT 
    COALESCE(CAST(number_id AS TEXT), CONCAT('legacy_', id::TEXT)) AS whatsapp_template_id,
    COALESCE(name360, title, 'unknown') AS name,
    COALESCE(language, 'en_US') AS language,
    content,
    COALESCE(params, '0') AS params,
    CASE WHEN active = 't' THEN true ELSE false END AS active,
    NOW() AS created_at,
    NOW() AS updated_at
FROM whatsapp_whatsapptemplate
WHERE NOT EXISTS (
    SELECT 1 FROM whatsapp_templates 
    WHERE whatsapp_templates.whatsapp_template_id = COALESCE(CAST(whatsapp_whatsapptemplate.number_id AS TEXT), CONCAT('legacy_', whatsapp_whatsapptemplate.id::TEXT))
)
ON CONFLICT (whatsapp_template_id) DO NOTHING;

-- Step 2: Update whatsapp_messages.template_id to point to new table
-- This maps old IDs to new auto-incrementing IDs
UPDATE whatsapp_messages wm
SET template_id = wt.id
FROM whatsapp_templates wt
WHERE wm.template_id IS NOT NULL
  AND EXISTS (
    SELECT 1 FROM whatsapp_whatsapptemplate wwt
    WHERE wwt.id = wm.template_id
      AND (CAST(wwt.number_id AS TEXT) = wt.whatsapp_template_id
           OR CONCAT('legacy_', wwt.id::TEXT) = wt.whatsapp_template_id)
  );

-- Note: After migration is complete and verified, you can:
-- 1. Update foreign key constraint: ALTER TABLE whatsapp_messages DROP CONSTRAINT whatsapp_messages_template_id_fkey;
-- 2. Add new foreign key: ALTER TABLE whatsapp_messages ADD CONSTRAINT whatsapp_messages_template_id_fkey FOREIGN KEY (template_id) REFERENCES whatsapp_templates(id) ON DELETE SET NULL;
-- 3. Drop old table: DROP TABLE IF EXISTS whatsapp_whatsapptemplate CASCADE;

