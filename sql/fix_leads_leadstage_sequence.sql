-- Fix the leads_leadstage sequence if it's out of sync
-- This can happen if data was imported or inserted manually

-- First, check the current sequence value
SELECT currval('leads_leadstage_id_seq') AS current_sequence_value;

-- Check the max ID in the table
SELECT MAX(id) AS max_id FROM leads_leadstage;

-- Set the sequence to the max ID + 1 (or 1 if table is empty)
SELECT setval(
  'leads_leadstage_id_seq',
  COALESCE((SELECT MAX(id) FROM leads_leadstage), 0) + 1,
  false  -- false means the next value will be the one we set (so it will be max + 1)
);

-- Verify the sequence is now correct
SELECT currval('leads_leadstage_id_seq') AS new_sequence_value;

