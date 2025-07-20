-- Update existing contracts to populate contact_name field
-- This script should be run after adding the contact_name column

-- First, let's see what we have
SELECT 
  c.id,
  c.contact_id,
  c.contact_name,
  l.name as client_name,
  l.additional_contacts
FROM contracts c
JOIN leads l ON c.client_id = l.id
WHERE c.contact_name IS NULL
ORDER BY c.created_at;

-- Update contracts where contact_id is 0 (main contact)
UPDATE contracts 
SET contact_name = (
  SELECT l.name 
  FROM leads l 
  WHERE l.id = contracts.client_id
)
WHERE contact_id = 0 
AND contact_name IS NULL;

-- Update contracts where contact_id > 0 (additional contacts)
-- This is more complex as we need to extract from additional_contacts array
-- For now, we'll set a placeholder that can be manually updated
UPDATE contracts 
SET contact_name = 'Contact ' || contact_id::text
WHERE contact_id > 0 
AND contact_name IS NULL;

-- Verify the updates
SELECT 
  c.id,
  c.contact_id,
  c.contact_name,
  l.name as client_name
FROM contracts c
JOIN leads l ON c.client_id = l.id
ORDER BY c.created_at; 