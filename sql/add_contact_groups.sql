-- Add Contact Groups functionality to database
-- This replaces localStorage with proper database storage

-- 1. Create contact_groups table
CREATE TABLE IF NOT EXISTS contact_groups (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  color text NOT NULL DEFAULT '#3b82f6',
  position integer DEFAULT 0,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- 2. Add group_id column to contacts table (if it doesn't exist)
ALTER TABLE contacts ADD COLUMN IF NOT EXISTS group_id uuid REFERENCES contact_groups(id) ON DELETE SET NULL;

-- 3. Ensure is_main_applicant column exists (should already exist, but adding for safety)
ALTER TABLE contacts ADD COLUMN IF NOT EXISTS is_main_applicant boolean DEFAULT false;

-- 4. Create indexes for better performance
CREATE INDEX IF NOT EXISTS idx_contacts_group_id ON contacts(group_id);
CREATE INDEX IF NOT EXISTS idx_contacts_is_main_applicant ON contacts(is_main_applicant);
CREATE INDEX IF NOT EXISTS idx_contact_groups_position ON contact_groups(position);

-- 5. Function to automatically update updated_at timestamp for contact_groups
CREATE OR REPLACE FUNCTION update_contact_groups_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- 6. Trigger to automatically update updated_at for contact_groups
DROP TRIGGER IF EXISTS trigger_update_contact_groups_updated_at ON contact_groups;
CREATE TRIGGER trigger_update_contact_groups_updated_at
  BEFORE UPDATE ON contact_groups
  FOR EACH ROW
  EXECUTE FUNCTION update_contact_groups_updated_at();

-- 7. Add comments for documentation
COMMENT ON TABLE contact_groups IS 'User-defined groups for organizing contacts';
COMMENT ON COLUMN contact_groups.name IS 'Display name of the group';
COMMENT ON COLUMN contact_groups.color IS 'Hex color code for group display (e.g., #3b82f6)';
COMMENT ON COLUMN contact_groups.position IS 'Display order position for groups';
COMMENT ON COLUMN contacts.group_id IS 'Foreign key to contact_groups table - groups contacts together';
COMMENT ON COLUMN contacts.is_main_applicant IS 'Boolean flag indicating if this contact is the main applicant within their group';
