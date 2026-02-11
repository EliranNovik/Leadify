-- Add Legacy Lead Support to lead_required_documents table
-- This allows document requirements to be created for legacy leads (non-UUID IDs)

-- 1. Make lead_id nullable to support legacy leads
ALTER TABLE lead_required_documents 
  ALTER COLUMN lead_id DROP NOT NULL;

-- 2. Add legacy_lead_id column for storing legacy lead IDs (numeric IDs as text)
ALTER TABLE lead_required_documents 
  ADD COLUMN IF NOT EXISTS legacy_lead_id TEXT;

-- 3. Add a check constraint to ensure either lead_id or legacy_lead_id is set
ALTER TABLE lead_required_documents 
  ADD CONSTRAINT check_lead_id_or_legacy 
  CHECK (
    (lead_id IS NOT NULL AND legacy_lead_id IS NULL) OR 
    (lead_id IS NULL AND legacy_lead_id IS NOT NULL)
  );

-- 4. Create index for legacy_lead_id for better query performance
CREATE INDEX IF NOT EXISTS idx_lead_required_documents_legacy_lead_id 
  ON lead_required_documents(legacy_lead_id);

-- 5. Add comment for documentation
COMMENT ON COLUMN lead_required_documents.legacy_lead_id IS 'Legacy lead ID (numeric) for leads from the old system. Used when lead_id is NULL.';

-- 6. Update the foreign key constraint to allow NULL (if it doesn't already)
-- Note: The existing foreign key should already allow NULL after step 1, but we'll verify
-- If there's an issue, we may need to drop and recreate the constraint
