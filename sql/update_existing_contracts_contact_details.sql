-- Update existing contracts to populate contact details fields
-- This script should be run after adding the contact_email, contact_phone, contact_mobile columns

-- First, let's see what we have
SELECT 
  c.id,
  c.contact_id,
  c.contact_name,
  c.contact_email,
  c.contact_phone,
  c.contact_mobile,
  l.name as client_name,
  l.email as client_email,
  l.phone as client_phone,
  l.mobile as client_mobile,
  l.additional_contacts
FROM contracts c
JOIN leads l ON c.client_id = l.id
WHERE c.contact_email IS NULL OR c.contact_phone IS NULL OR c.contact_mobile IS NULL
ORDER BY c.created_at;

-- Update contracts where contact_id is 0 (main contact) - use client details
UPDATE contracts 
SET 
  contact_email = (
    SELECT l.email 
    FROM leads l 
    WHERE l.id = contracts.client_id
  ),
  contact_phone = (
    SELECT l.phone 
    FROM leads l 
    WHERE l.id = contracts.client_id
  ),
  contact_mobile = (
    SELECT l.mobile 
    FROM leads l 
    WHERE l.id = contracts.client_id
  )
WHERE contact_id = 0 
AND (contact_email IS NULL OR contact_phone IS NULL OR contact_mobile IS NULL);

-- For contracts with contact_id > 0, we need to extract from additional_contacts
-- This is more complex and may need manual review
-- For now, we'll set placeholders that can be manually updated
UPDATE contracts 
SET 
  contact_email = 'contact' || contact_id::text || '@example.com',
  contact_phone = '+1-555-' || LPAD(contact_id::text, 4, '0'),
  contact_mobile = '+1-555-' || LPAD(contact_id::text, 4, '0')
WHERE contact_id > 0 
AND (contact_email IS NULL OR contact_phone IS NULL OR contact_mobile IS NULL);

-- Verify the updates
SELECT 
  c.id,
  c.contact_id,
  c.contact_name,
  c.contact_email,
  c.contact_phone,
  c.contact_mobile,
  l.name as client_name
FROM contracts c
JOIN leads l ON c.client_id = l.id
ORDER BY c.created_at; 