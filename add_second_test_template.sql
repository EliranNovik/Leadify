-- Add the second_test template to the whatsapp_templates table
INSERT INTO whatsapp_templates (title, name360, category, params, content, is_active) 
VALUES (
  'Second Test',
  'second_test', 
  'Marketing',
  '0', -- No parameters required
  'Eliran made the second test!',
  true
) ON CONFLICT (title) DO UPDATE SET
  name360 = EXCLUDED.name360,
  category = EXCLUDED.category,
  params = EXCLUDED.params,
  content = EXCLUDED.content,
  is_active = EXCLUDED.is_active;

-- Also add hello_world template if it doesn't exist
INSERT INTO whatsapp_templates (title, name360, category, params, content, is_active) 
VALUES (
  'Hello World',
  'hello_world', 
  'Utility',
  '0', -- No parameters required
  'Welcome and congratulations!! Thank you for choosing our services.',
  true
) ON CONFLICT (title) DO UPDATE SET
  name360 = EXCLUDED.name360,
  category = EXCLUDED.category,
  params = EXCLUDED.params,
  content = EXCLUDED.content,
  is_active = EXCLUDED.is_active;

-- Also add email_request template if it doesn't exist
INSERT INTO whatsapp_templates (title, name360, category, params, content, is_active) 
VALUES (
  'Email Request',
  'email_request', 
  'Marketing',
  '0', -- No parameters required
  'Hello! 👋 Could you please share your email address so we can send you more information?',
  true
) ON CONFLICT (title) DO UPDATE SET
  name360 = EXCLUDED.name360,
  category = EXCLUDED.category,
  params = EXCLUDED.params,
  content = EXCLUDED.content,
  is_active = EXCLUDED.is_active;
