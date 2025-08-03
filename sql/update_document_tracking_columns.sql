-- Update the lead_required_documents table to change changed_by columns from UUID to TEXT
-- This allows storing full names directly instead of UUIDs

-- Change requested_from_changed_by column from UUID to TEXT
ALTER TABLE lead_required_documents 
ALTER COLUMN requested_from_changed_by TYPE TEXT;

-- Change received_from_changed_by column from UUID to TEXT
ALTER TABLE lead_required_documents 
ALTER COLUMN received_from_changed_by TYPE TEXT;

-- Update any existing UUID values to 'Unknown User' (since we can't convert UUIDs to names)
UPDATE lead_required_documents 
SET requested_from_changed_by = 'Unknown User' 
WHERE requested_from_changed_by IS NOT NULL 
AND requested_from_changed_by ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$';

UPDATE lead_required_documents 
SET received_from_changed_by = 'Unknown User' 
WHERE received_from_changed_by IS NOT NULL 
AND received_from_changed_by ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'; 