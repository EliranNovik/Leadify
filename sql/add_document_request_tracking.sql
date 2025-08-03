-- Add columns for document request and received tracking
ALTER TABLE lead_required_documents 
ADD COLUMN requested_from VARCHAR(50) DEFAULT NULL,
ADD COLUMN received_from VARCHAR(50) DEFAULT NULL,
ADD COLUMN requested_from_changed_at TIMESTAMP WITH TIME ZONE DEFAULT NULL,
ADD COLUMN received_from_changed_at TIMESTAMP WITH TIME ZONE DEFAULT NULL,
ADD COLUMN requested_from_changed_by UUID DEFAULT NULL,
ADD COLUMN received_from_changed_by UUID DEFAULT NULL;

-- Add constraints for valid values
ALTER TABLE lead_required_documents 
ADD CONSTRAINT check_requested_from 
CHECK (requested_from IN ('Ministry of Interior', 'Rabbinical Office', 'Foreign Ministry', 'Client') OR requested_from IS NULL);

ALTER TABLE lead_required_documents 
ADD CONSTRAINT check_received_from 
CHECK (received_from IN ('Ministry of Interior', 'Rabbinical Office', 'Foreign Ministry', 'Client') OR received_from IS NULL);

-- Create function to update requested_from with tracking
CREATE OR REPLACE FUNCTION update_document_requested_from_with_tracking(
  p_document_id UUID,
  p_requested_from VARCHAR(50),
  p_changed_by UUID
)
RETURNS VOID AS $$
BEGIN
  -- Update the document
  UPDATE lead_required_documents 
  SET 
    requested_from = p_requested_from,
    requested_from_changed_at = NOW(),
    requested_from_changed_by = p_changed_by,
    updated_at = NOW()
  WHERE id = p_document_id;
  
  -- Log the change (you can add this to a separate tracking table if needed)
  -- INSERT INTO document_changes_log (document_id, field_name, old_value, new_value, changed_by, changed_at)
  -- VALUES (p_document_id, 'requested_from', (SELECT requested_from FROM lead_required_documents WHERE id = p_document_id), p_requested_from, p_changed_by, NOW());
END;
$$ LANGUAGE plpgsql;

-- Create function to update received_from with tracking
CREATE OR REPLACE FUNCTION update_document_received_from_with_tracking(
  p_document_id UUID,
  p_received_from VARCHAR(50),
  p_changed_by UUID
)
RETURNS VOID AS $$
BEGIN
  -- Update the document
  UPDATE lead_required_documents 
  SET 
    received_from = p_received_from,
    received_from_changed_at = NOW(),
    received_from_changed_by = p_changed_by,
    updated_at = NOW()
  WHERE id = p_document_id;
  
  -- Log the change (you can add this to a separate tracking table if needed)
  -- INSERT INTO document_changes_log (document_id, field_name, old_value, new_value, changed_by, changed_at)
  -- VALUES (p_document_id, 'received_from', (SELECT received_from FROM lead_required_documents WHERE id = p_document_id), p_received_from, p_changed_by, NOW());
END;
$$ LANGUAGE plpgsql; 