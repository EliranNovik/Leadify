-- Temporarily disable the handler_stage_check constraint
ALTER TABLE leads DISABLE TRIGGER ALL;

-- Drop the existing constraint
ALTER TABLE leads DROP CONSTRAINT IF EXISTS handler_stage_check;

-- Add the updated constraint with "Documents Requested" included
ALTER TABLE leads 
ADD CONSTRAINT handler_stage_check 
CHECK (handler_stage IN (
    'pending_payment',
    'documents_requested',
    'documents_pending', 
    'all_documents_received',
    'application_form_processing',
    'application_submitted',
    'application_approved',
    'application_rejected'
) OR handler_stage IS NULL);

-- Re-enable triggers
ALTER TABLE leads ENABLE TRIGGER ALL;

-- Verify the constraint works
SELECT DISTINCT handler_stage FROM leads WHERE handler_stage IS NOT NULL; 