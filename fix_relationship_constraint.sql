-- Fix existing relationship values before adding constraint

-- First, let's see what relationship values currently exist
SELECT DISTINCT relationship, COUNT(*) 
FROM contacts 
WHERE relationship IS NOT NULL
GROUP BY relationship
ORDER BY relationship;

-- Update existing relationship values to match new constraint
UPDATE contacts SET relationship = 'persecuted_person' WHERE relationship = 'main_applicant';
UPDATE contacts SET relationship = 'persecuted_person' WHERE relationship IS NULL;
UPDATE contacts SET relationship = 'other' WHERE relationship NOT IN (
  'persecuted_person', 'spouse', 'child', 'parent', 'sibling', 
  'grandchild', 'grandparent', 'great_grandchild', 'great_grandparent', 
  'grandson', 'granddaughter', 'great_grandson', 'great_granddaughter',
  'nephew', 'niece', 'cousin', 'uncle', 'aunt', 'in_law', 'other'
);

-- Now safely add the constraint
DO $$ 
BEGIN
  -- Drop constraint if it exists first
  IF EXISTS (
    SELECT 1 FROM information_schema.table_constraints 
    WHERE constraint_name = 'contacts_relationship_check' 
    AND table_name = 'contacts'
  ) THEN
    ALTER TABLE contacts DROP CONSTRAINT contacts_relationship_check;
  END IF;
  
  -- Add the constraint
  ALTER TABLE contacts ADD CONSTRAINT contacts_relationship_check 
  CHECK (relationship IN (
    'persecuted_person', 'spouse', 'child', 'parent', 'sibling', 
    'grandchild', 'grandparent', 'great_grandchild', 'great_grandparent', 
    'grandson', 'granddaughter', 'great_grandson', 'great_granddaughter',
    'nephew', 'niece', 'cousin', 'uncle', 'aunt', 'in_law', 'other'
  ));
END $$;

-- Verify the constraint was added successfully
SELECT constraint_name, check_clause 
FROM information_schema.check_constraints 
WHERE constraint_name = 'contacts_relationship_check'; 