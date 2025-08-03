-- Step 1: Check what values currently exist in handler_stage
SELECT DISTINCT handler_stage FROM leads WHERE handler_stage IS NOT NULL;

-- Step 2: Check if there are any invalid values that need to be updated
SELECT handler_stage, COUNT(*) 
FROM leads 
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
)
GROUP BY handler_stage;

-- Step 3: Update any invalid values to a safe default
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

-- Step 4: Drop the existing constraint
ALTER TABLE leads DROP CONSTRAINT IF EXISTS handler_stage_check;

-- Step 5: Add the new constraint
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

-- Step 6: Verify everything works
SELECT DISTINCT handler_stage FROM leads WHERE handler_stage IS NOT NULL; 