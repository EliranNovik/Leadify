-- Enable the templates since they CAN be used (just pending quality rating)
UPDATE whatsapp_whatsapptemplate 
SET active = 't' 
WHERE name360 IN ('second_test', 'email_request', 'hello_world');

-- Check the status
SELECT title, name360, active, category 
FROM whatsapp_whatsapptemplate 
WHERE name360 IN ('second_test', 'email_request', 'hello_world')
ORDER BY title;
