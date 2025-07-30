-- Document Status Tracking System
-- Tracks all status changes for documents with timestamps and user information

-- Create document status history table
CREATE TABLE IF NOT EXISTS document_status_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  document_id uuid REFERENCES lead_required_documents(id) ON DELETE CASCADE,
  lead_id uuid REFERENCES leads(id) ON DELETE CASCADE,
  contact_id uuid REFERENCES contacts(id) ON DELETE CASCADE,
  old_status text,
  new_status text NOT NULL,
  changed_by uuid, -- user who made the change
  changed_by_name text, -- name of user for quick display
  change_reason text, -- optional reason for status change
  notes text, -- additional notes about the change
  created_at timestamptz DEFAULT now()
);

-- Create indexes for performance
CREATE INDEX IF NOT EXISTS idx_document_status_history_document_id ON document_status_history(document_id);
CREATE INDEX IF NOT EXISTS idx_document_status_history_lead_id ON document_status_history(lead_id);
CREATE INDEX IF NOT EXISTS idx_document_status_history_contact_id ON document_status_history(contact_id);
CREATE INDEX IF NOT EXISTS idx_document_status_history_created_at ON document_status_history(created_at);

-- Function to log document status changes
CREATE OR REPLACE FUNCTION log_document_status_change()
RETURNS TRIGGER AS $$
BEGIN
  -- Only log if status actually changed
  IF OLD.status IS DISTINCT FROM NEW.status THEN
    INSERT INTO document_status_history (
      document_id,
      lead_id,
      contact_id,
      old_status,
      new_status,
      changed_by,
      changed_by_name
    ) VALUES (
      NEW.id,
      NEW.lead_id,
      NEW.contact_id,
      OLD.status,
      NEW.status,
      COALESCE(current_setting('app.current_user_id', true)::uuid, '00000000-0000-0000-0000-000000000000'),
      COALESCE(current_setting('app.current_user_name', true), 'System')
    );
  END IF;
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Create trigger for automatic status change logging
DROP TRIGGER IF EXISTS trigger_log_document_status_change ON lead_required_documents;
CREATE TRIGGER trigger_log_document_status_change
  AFTER UPDATE ON lead_required_documents
  FOR EACH ROW
  EXECUTE FUNCTION log_document_status_change();

-- Function to get document status history for a lead
CREATE OR REPLACE FUNCTION get_document_status_history(p_lead_id uuid)
RETURNS TABLE(
  id uuid,
  document_name text,
  contact_name text,
  old_status text,
  new_status text,
  changed_by_name text,
  change_reason text,
  notes text,
  created_at timestamptz
) AS $$
BEGIN
  RETURN QUERY
  SELECT 
    dsh.id,
    lrd.document_name,
    c.name as contact_name,
    dsh.old_status,
    dsh.new_status,
    dsh.changed_by_name,
    dsh.change_reason,
    dsh.notes,
    dsh.created_at
  FROM document_status_history dsh
  JOIN lead_required_documents lrd ON dsh.document_id = lrd.id
  LEFT JOIN contacts c ON dsh.contact_id = c.id
  WHERE dsh.lead_id = p_lead_id
  ORDER BY dsh.created_at DESC;
END;
$$ LANGUAGE plpgsql;

-- Function to get recent document activities for dashboard
CREATE OR REPLACE FUNCTION get_recent_document_activities(p_limit integer DEFAULT 10)
RETURNS TABLE(
  id uuid,
  lead_id uuid,
  lead_name text,
  document_name text,
  contact_name text,
  old_status text,
  new_status text,
  changed_by_name text,
  created_at timestamptz
) AS $$
BEGIN
  RETURN QUERY
  SELECT 
    dsh.id,
    dsh.lead_id,
    l.name as lead_name,
    lrd.document_name,
    c.name as contact_name,
    dsh.old_status,
    dsh.new_status,
    dsh.changed_by_name,
    dsh.created_at
  FROM document_status_history dsh
  JOIN lead_required_documents lrd ON dsh.document_id = lrd.id
  JOIN leads l ON dsh.lead_id = l.id
  LEFT JOIN contacts c ON dsh.contact_id = c.id
  ORDER BY dsh.created_at DESC
  LIMIT p_limit;
END;
$$ LANGUAGE plpgsql;

-- Function to update document status with tracking
CREATE OR REPLACE FUNCTION update_document_status_with_tracking(
  p_document_id uuid,
  p_new_status text,
  p_changed_by uuid,
  p_change_reason text DEFAULT NULL,
  p_notes text DEFAULT NULL
)
RETURNS boolean AS $$
DECLARE
  update_data jsonb;
  user_full_name text;
BEGIN
  -- Get user's full name from users table
  SELECT full_name INTO user_full_name
  FROM users 
  WHERE id = p_changed_by;
  
  -- If user not found, use a default name
  IF user_full_name IS NULL THEN
    user_full_name := 'Unknown User';
  END IF;

  -- Set session variables for trigger
  PERFORM set_config('app.current_user_id', p_changed_by::text, true);
  PERFORM set_config('app.current_user_name', user_full_name, true);
  
  -- Build update data based on status
  update_data := jsonb_build_object('status', p_new_status);
  
  IF p_new_status = 'received' THEN
    update_data := update_data || jsonb_build_object('received_date', now());
  ELSIF p_new_status = 'approved' THEN
    update_data := update_data || jsonb_build_object('approved_date', now());
  END IF;
  
  -- Update the document
  UPDATE lead_required_documents 
  SET 
    status = p_new_status,
    received_date = CASE WHEN p_new_status = 'received' THEN now() ELSE received_date END,
    approved_date = CASE WHEN p_new_status = 'approved' THEN now() ELSE approved_date END,
    updated_at = now()
  WHERE id = p_document_id;
  
  -- Add additional tracking info if provided
  IF p_change_reason IS NOT NULL OR p_notes IS NOT NULL THEN
    UPDATE document_status_history 
    SET 
      change_reason = p_change_reason,
      notes = p_notes
    WHERE document_id = p_document_id 
    AND created_at = (
      SELECT MAX(created_at) 
      FROM document_status_history 
      WHERE document_id = p_document_id
    );
  END IF;
  
  RETURN true;
END;
$$ LANGUAGE plpgsql;

-- Create sample data for testing (optional)
-- Note: This will only work if you have existing documents
DO $$
BEGIN
  -- Add some sample status changes for existing documents
  IF EXISTS (SELECT 1 FROM lead_required_documents LIMIT 1) THEN
    -- Set some documents to received status for demo
    PERFORM update_document_status_with_tracking(
      id,
      'received',
      '00000000-0000-0000-0000-000000000000',
      'System Demo',
      'Initial demo data',
      'Sample status change for testing'
    )
    FROM lead_required_documents 
    WHERE status = 'pending'
    LIMIT 2;
  END IF;
END $$; 