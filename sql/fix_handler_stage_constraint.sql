-- Fix handler stage constraint by handling existing invalid data
-- First, check what values currently exist in handler_stage
SELECT DISTINCT handler_stage FROM leads WHERE handler_stage IS NOT NULL;

-- Update any invalid or old values to a valid default
UPDATE leads 
SET handler_stage = 'pending_payment' 
WHERE handler_stage IS NOT NULL 
AND handler_stage NOT IN (
    'pending_payment',
    'documents_requested',
    'documents_pending', 
    'all_documents_received',
    'application_form_processing',
    'application_submitted',
    'application_approved',
    'application_rejected'
);

-- Now drop the existing constraint if it exists
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

-- Verify the constraint works by checking current values
SELECT DISTINCT handler_stage FROM leads WHERE handler_stage IS NOT NULL; 