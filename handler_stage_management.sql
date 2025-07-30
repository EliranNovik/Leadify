-- Handler Stage Management SQL
-- Add handler_stage column to leads table for handler-specific workflow tracking

-- Add handler_stage column to leads table
ALTER TABLE leads ADD COLUMN IF NOT EXISTS handler_stage text DEFAULT 'pending_review';

-- Add constraint for valid handler stages (drop first if exists)
DO $$ 
BEGIN
  -- Drop constraint if it exists
  IF EXISTS (SELECT 1 FROM information_schema.table_constraints 
             WHERE constraint_name = 'handler_stage_check' 
             AND table_name = 'leads') THEN
    ALTER TABLE leads DROP CONSTRAINT handler_stage_check;
  END IF;
  
  -- Add the constraint
  ALTER TABLE leads ADD CONSTRAINT handler_stage_check 
  CHECK (handler_stage IN (
    'pending_review',       -- Initial state when assigned to handler
    'documents_requested',  -- Handler has requested documents from client
    'documents_pending',    -- Waiting for client to provide documents
    'documents_received',   -- Client has provided documents
    'under_review',         -- Handler is reviewing documents
    'additional_info_needed', -- Need more information from client
    'ready_for_processing', -- All documents complete, ready for next stage
    'processing',           -- Currently being processed
    'completed',            -- Handler work completed
    'on_hold',              -- Case on hold for various reasons
    'escalated'             -- Escalated to senior handler or management
  ));
END $$;

-- Create index for handler_stage for better performance
CREATE INDEX IF NOT EXISTS idx_leads_handler_stage ON leads(handler_stage);

-- Update existing handler_assigned leads to have initial handler_stage
UPDATE leads 
SET handler_stage = 'pending_review' 
WHERE stage = 'handler_assigned' 
AND handler_stage IS NULL;

-- Create handler stage history table for tracking stage changes
CREATE TABLE IF NOT EXISTS handler_stage_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id uuid REFERENCES leads(id) ON DELETE CASCADE,
  previous_stage text,
  new_stage text NOT NULL,
  changed_by text NOT NULL,
  change_reason text,
  changed_at timestamptz DEFAULT now(),
  notes text
);

-- Create index for handler stage history
CREATE INDEX IF NOT EXISTS idx_handler_stage_history_lead_id ON handler_stage_history(lead_id);
CREATE INDEX IF NOT EXISTS idx_handler_stage_history_changed_at ON handler_stage_history(changed_at);

-- Function to log handler stage changes
CREATE OR REPLACE FUNCTION log_handler_stage_change()
RETURNS TRIGGER AS $$
BEGIN
  -- Only log if handler_stage actually changed
  IF OLD.handler_stage IS DISTINCT FROM NEW.handler_stage THEN
    INSERT INTO handler_stage_history (
      lead_id,
      previous_stage,
      new_stage,
      changed_by,
      change_reason
    ) VALUES (
      NEW.id,
      OLD.handler_stage,
      NEW.handler_stage,
      'system', -- This should be replaced with actual user in the application
      'Stage updated via handler dashboard'
    );
  END IF;
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Create trigger for logging handler stage changes
DROP TRIGGER IF EXISTS trigger_log_handler_stage_change ON leads;
CREATE TRIGGER trigger_log_handler_stage_change
  AFTER UPDATE ON leads
  FOR EACH ROW
  EXECUTE FUNCTION log_handler_stage_change();

-- Function to get handler stage statistics
CREATE OR REPLACE FUNCTION get_handler_stage_stats()
RETURNS TABLE(
  stage text,
  count bigint
) AS $$
BEGIN
  RETURN QUERY
  SELECT 
    l.handler_stage as stage,
    COUNT(*) as count
  FROM leads l
  WHERE l.stage = 'handler_assigned'
  AND l.handler_stage IS NOT NULL
  GROUP BY l.handler_stage
  ORDER BY 
    CASE l.handler_stage
      WHEN 'pending_review' THEN 1
      WHEN 'documents_requested' THEN 2
      WHEN 'documents_pending' THEN 3
      WHEN 'documents_received' THEN 4
      WHEN 'under_review' THEN 5
      WHEN 'additional_info_needed' THEN 6
      WHEN 'ready_for_processing' THEN 7
      WHEN 'processing' THEN 8
      WHEN 'on_hold' THEN 9
      WHEN 'escalated' THEN 10
      WHEN 'completed' THEN 11
      ELSE 12
    END;
END;
$$ LANGUAGE plpgsql;

-- Insert some sample handler stage changes for testing
INSERT INTO handler_stage_history (lead_id, previous_stage, new_stage, changed_by, change_reason, notes)
SELECT 
  id as lead_id,
  NULL as previous_stage,
  'pending_review' as new_stage,
  'system' as changed_by,
  'Initial assignment to handler' as change_reason,
  'Lead assigned to handler for document processing' as notes
FROM leads 
WHERE stage = 'handler_assigned'
AND id NOT IN (SELECT lead_id FROM handler_stage_history)
LIMIT 5;

-- Update some leads to different handler stages for testing
UPDATE leads 
SET handler_stage = 'documents_requested' 
WHERE stage = 'handler_assigned' 
AND handler_stage = 'pending_review'
AND id IN (
  SELECT id FROM leads 
  WHERE stage = 'handler_assigned' 
  LIMIT 2
);

UPDATE leads 
SET handler_stage = 'documents_pending' 
WHERE stage = 'handler_assigned' 
AND handler_stage = 'pending_review'
AND id IN (
  SELECT id FROM leads 
  WHERE stage = 'handler_assigned' 
  AND handler_stage = 'pending_review'
  LIMIT 1
); 