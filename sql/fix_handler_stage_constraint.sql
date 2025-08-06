-- Fix handler_stage constraint to include 'pending_review'
-- This script updates the constraint to match the values used in handler_stage_management.sql

-- Step 1: Drop the existing constraint
ALTER TABLE leads DROP CONSTRAINT IF EXISTS handler_stage_check;

-- Step 2: Add the updated constraint with 'pending_review' included
ALTER TABLE leads 
ADD CONSTRAINT handler_stage_check 
CHECK (handler_stage IN (
    'pending_review',       -- Initial state when assigned to handler
    'pending_payment',
    'documents_requested',
    'documents_pending', 
    'all_documents_received',
    'application_form_processing',
    'application_submitted',
    'application_approved',
    'application_rejected'
) OR handler_stage IS NULL);

-- Step 3: Verify the constraint works
SELECT DISTINCT handler_stage FROM leads WHERE handler_stage IS NOT NULL; 