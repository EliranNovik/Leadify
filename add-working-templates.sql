-- Add a simple template that should work in your current account
-- First, let's add a basic hello_world template

INSERT INTO whatsapp_whatsapptemplate (title, name360, category, params, content, active) 
VALUES (
  'Hello World Simple',
  'hello_world',
  'Utility',
  '0', -- No parameters
  'Hello! Welcome to our service.',
  't'
) ON CONFLICT (title) DO UPDATE SET
  name360 = EXCLUDED.name360,
  category = EXCLUDED.category,
  params = EXCLUDED.params,
  content = EXCLUDED.content,
  active = EXCLUDED.active;

-- Also add a simple test template
INSERT INTO whatsapp_whatsapptemplate (title, name360, category, params, content, active) 
VALUES (
  'Simple Test',
  'simple_test',
  'Marketing',
  '0', -- No parameters
  'This is a simple test message.',
  't'
) ON CONFLICT (title) DO UPDATE SET
  name360 = EXCLUDED.name360,
  category = EXCLUDED.category,
  params = EXCLUDED.params,
  content = EXCLUDED.content,
  active = EXCLUDED.active;

-- Check what templates we now have
SELECT title, name360, active, category 
FROM whatsapp_whatsapptemplate 
WHERE active = 't'
ORDER BY title;
