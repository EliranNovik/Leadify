-- Test script for create_lead_with_source_validation function
-- This script tests the function with different scenarios

-- Test 1: Create lead with valid source code (2165 - Website Form)
SELECT * FROM create_lead_with_source_validation(
  'Test User 1',
  'test1@example.com',
  '+1234567890',
  'German Citizenship',
  'English',
  'Webhook',
  'webhook@system',
  2165,
  'NIS',
  'NIS'
);

-- Test 2: Create lead with invalid source code (should fail)
-- SELECT * FROM create_lead_with_source_validation(
--   'Test User 2',
--   'test2@example.com',
--   '+1234567891',
--   'Austrian Citizenship',
--   'English',
--   'Webhook',
--   'webhook@system',
--   99999,
--   'NIS',
--   'NIS'
-- );

-- Test 3: Create lead without source code (should work)
-- SELECT * FROM create_lead_with_source_validation(
--   'Test User 3',
--   'test3@example.com',
--   '+1234567892',
--   'Romanian Citizenship',
--   'English',
--   'Webhook',
--   'webhook@system',
--   NULL,
--   'NIS',
--   'NIS'
-- );

-- Test 4: Create lead with source code that has default topic (350 - Marketism Au)
-- SELECT * FROM create_lead_with_source_validation(
--   'Test User 4',
--   'test4@example.com',
--   '+1234567893',
--   'Custom Topic',
--   'English',
--   'Webhook',
--   'webhook@system',
--   350,
--   'NIS',
--   'NIS'
-- );

-- Check the leads_lead table to see the highest ID
-- SELECT MAX(id) as max_lead_id FROM leads_lead;
