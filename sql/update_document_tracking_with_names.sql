-- Function to update document requested_from with full name tracking
CREATE OR REPLACE FUNCTION update_document_requested_from_with_name_tracking(
  p_document_id UUID,
  p_requested_from TEXT,
  p_changed_by_name TEXT
) RETURNS VOID AS $$
BEGIN
  -- Update the document with the new requested_from value
  UPDATE lead_required_documents 
  SET 
    requested_from = p_requested_from,
    requested_from_changed_at = NOW(),
    requested_from_changed_by = p_changed_by_name
  WHERE id = p_document_id;
END;
$$ LANGUAGE plpgsql;

-- Function to update document received_from with full name tracking
CREATE OR REPLACE FUNCTION update_document_received_from_with_name_tracking(
  p_document_id UUID,
  p_received_from TEXT,
  p_changed_by_name TEXT
) RETURNS VOID AS $$
BEGIN
  -- Update the document with the new received_from value
  UPDATE lead_required_documents 
  SET 
    received_from = p_received_from,
    received_from_changed_at = NOW(),
    received_from_changed_by = p_changed_by_name
  WHERE id = p_document_id;
END;
$$ LANGUAGE plpgsql; 