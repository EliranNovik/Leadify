-- Update handler stage options to include "Documents Requested"
-- First, check if the constraint exists and drop it if it does
DO $$ 
BEGIN
    -- Drop the existing constraint if it exists
    IF EXISTS (
        SELECT 1 FROM information_schema.table_constraints 
        WHERE constraint_name = 'check_handler_stage' 
        AND table_name = 'leads'
    ) THEN
        ALTER TABLE leads DROP CONSTRAINT check_handler_stage;
    END IF;
END $$;

-- Add the updated constraint with "Documents Requested" included
ALTER TABLE leads 
ADD CONSTRAINT check_handler_stage 
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

-- Update any existing records that might have the old value
-- (This is optional, only if you need to migrate existing data)
-- UPDATE leads SET handler_stage = 'documents_requested' WHERE handler_stage = 'old_value'; 