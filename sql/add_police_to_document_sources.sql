-- Add "Police" and "Embassy" as options for document sources
-- First, drop the existing constraints
ALTER TABLE lead_required_documents 
DROP CONSTRAINT IF EXISTS check_requested_from;

ALTER TABLE lead_required_documents 
DROP CONSTRAINT IF EXISTS check_received_from;

-- Add the updated constraints with "Police" and "Embassy" included
ALTER TABLE lead_required_documents 
ADD CONSTRAINT check_requested_from 
CHECK (requested_from IN ('Ministry of Interior', 'Rabbinical Office', 'Foreign Ministry', 'Client', 'Police', 'Embassy') OR requested_from IS NULL);

ALTER TABLE lead_required_documents 
ADD CONSTRAINT check_received_from 
CHECK (received_from IN ('Ministry of Interior', 'Rabbinical Office', 'Foreign Ministry', 'Client', 'Police', 'Embassy') OR received_from IS NULL); 