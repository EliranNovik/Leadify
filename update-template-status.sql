-- Update template status to reflect Meta's actual status
-- Since all templates are "Active - Quality pending", mark them as inactive in database
-- so they won't be selectable until Meta approves them

UPDATE whatsapp_whatsapptemplate 
SET active = 'f' 
WHERE name360 IN ('second_test', 'email_request', 'hello_world');

-- Check the updated status
SELECT title, name360, active, category 
FROM whatsapp_whatsapptemplate 
WHERE name360 IN ('second_test', 'email_request', 'hello_world')
ORDER BY title;

-- Show only truly active templates
SELECT title, name360, active, category 
FROM whatsapp_whatsapptemplate 
WHERE active = 't'
ORDER BY title;
