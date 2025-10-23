-- Test script to verify category mapping in create_lead_with_source_validation function

-- First, let's see what categories are available
SELECT id, name FROM misc_category ORDER BY id LIMIT 10;

-- Check what source codes have default_category_id set
SELECT code, name, default_category_id, default_topic 
FROM misc_leadsource 
WHERE default_category_id IS NOT NULL 
ORDER BY code;

-- Test the function with a source code that has default_category_id
-- Replace 2165 with an actual source code that has default_category_id
SELECT * FROM create_lead_with_source_validation(
  'Test Lead Category Mapping',
  'test@example.com',
  '+1234567890',
  'Test Topic',
  'English',
  'Webhook Test',
  'test@system',
  2165, -- Replace with actual source code
  'NIS',
  'NIS'
);

-- Check the created lead to see if category was set correctly
SELECT id, lead_number, name, category, source_id, topic 
FROM leads 
WHERE name = 'Test Lead Category Mapping' 
ORDER BY created_at DESC 
LIMIT 1;
