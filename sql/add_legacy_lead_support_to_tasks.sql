-- Add Legacy Lead Support to handler_tasks table
-- This allows tasks to be created for legacy leads (non-UUID IDs)

-- 1. Make lead_id nullable to support legacy leads
ALTER TABLE handler_tasks
  ALTER COLUMN lead_id DROP NOT NULL;

-- 2. Add legacy_lead_id column for storing legacy lead IDs (numeric IDs as text)
ALTER TABLE handler_tasks
  ADD COLUMN IF NOT EXISTS legacy_lead_id TEXT;

-- 3. Add a check constraint to ensure either lead_id or legacy_lead_id is set
ALTER TABLE handler_tasks
  ADD CONSTRAINT check_lead_id_or_legacy_tasks
  CHECK (
    (lead_id IS NOT NULL AND legacy_lead_id IS NULL) OR 
    (lead_id IS NULL AND legacy_lead_id IS NOT NULL)
  );

-- 4. Create index for legacy_lead_id for better query performance
CREATE INDEX IF NOT EXISTS idx_handler_tasks_legacy_lead_id
  ON handler_tasks(legacy_lead_id);

-- 5. Add comment for documentation
COMMENT ON COLUMN handler_tasks.legacy_lead_id IS 'Legacy lead ID (numeric) for leads from the old system. Used when lead_id is NULL.';
