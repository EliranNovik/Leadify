-- Fix the template database to only show templates that work with your current setup
-- Remove templates that don't exist in your phone number account

-- First, remove templates that don't work with your current phone number token
DELETE FROM whatsapp_whatsapptemplate 
WHERE name360 IN ('second_test', 'email_request', 'hello_world');

-- Add a simple template that should work (no parameters needed)
INSERT INTO whatsapp_whatsapptemplate (title, name360, category, params, content, active) 
VALUES (
  'Simple Hello',
  'simple_hello',
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

-- Add another simple template
INSERT INTO whatsapp_whatsapptemplate (title, name360, category, params, content, active) 
VALUES (
  'Test Message',
  'test_message',
  'Marketing',
  '0', -- No parameters
  'This is a test message from our service.',
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
