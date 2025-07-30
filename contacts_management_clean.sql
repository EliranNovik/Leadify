-- Contacts and Family Members Management - Clean Version
-- No sample data, just table structures and functions

-- Main contacts table
CREATE TABLE IF NOT EXISTS contacts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id uuid REFERENCES leads(id) ON DELETE CASCADE,
  name text NOT NULL,
  email text,
  phone text,
  relationship text CHECK (relationship IN (
    'persecuted_person', 'spouse', 'child', 'parent', 'sibling', 
    'grandchild', 'grandparent', 'great_grandchild', 'great_grandparent', 
    'grandson', 'granddaughter', 'great_grandson', 'great_granddaughter',
    'nephew', 'niece', 'cousin', 'uncle', 'aunt', 'in_law', 'other'
  )),
  birth_date date,
  death_date date,
  birth_place text,
  current_address text,
  citizenship text,
  passport_number text,
  id_number text,
  is_main_applicant boolean DEFAULT false,
  is_persecuted boolean DEFAULT false,
  persecution_details jsonb,
  contact_notes text,
  document_status text DEFAULT 'pending',
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- Add columns to existing contacts table if they don't exist
ALTER TABLE contacts ADD COLUMN IF NOT EXISTS lead_id uuid REFERENCES leads(id) ON DELETE CASCADE;
ALTER TABLE contacts ADD COLUMN IF NOT EXISTS relationship text DEFAULT 'persecuted_person';
ALTER TABLE contacts ADD COLUMN IF NOT EXISTS birth_date date;
ALTER TABLE contacts ADD COLUMN IF NOT EXISTS death_date date;
ALTER TABLE contacts ADD COLUMN IF NOT EXISTS birth_place text;
ALTER TABLE contacts ADD COLUMN IF NOT EXISTS current_address text;
ALTER TABLE contacts ADD COLUMN IF NOT EXISTS citizenship text;
ALTER TABLE contacts ADD COLUMN IF NOT EXISTS passport_number text;
ALTER TABLE contacts ADD COLUMN IF NOT EXISTS id_number text;
ALTER TABLE contacts ADD COLUMN IF NOT EXISTS is_main_applicant boolean DEFAULT false;
ALTER TABLE contacts ADD COLUMN IF NOT EXISTS is_persecuted boolean DEFAULT false;
ALTER TABLE contacts ADD COLUMN IF NOT EXISTS persecution_details jsonb;
ALTER TABLE contacts ADD COLUMN IF NOT EXISTS contact_notes text;
ALTER TABLE contacts ADD COLUMN IF NOT EXISTS document_status text DEFAULT 'pending';
ALTER TABLE contacts ADD COLUMN IF NOT EXISTS created_at timestamptz DEFAULT now();
ALTER TABLE contacts ADD COLUMN IF NOT EXISTS updated_at timestamptz DEFAULT now();

-- Update existing relationship values and add constraint safely
DO $$ 
BEGIN
  -- First update any incompatible relationship values
  UPDATE contacts SET relationship = 'persecuted_person' WHERE relationship = 'main_applicant';
  UPDATE contacts SET relationship = 'persecuted_person' WHERE relationship IS NULL;
  UPDATE contacts SET relationship = 'other' WHERE relationship NOT IN (
    'persecuted_person', 'spouse', 'child', 'parent', 'sibling', 
    'grandchild', 'grandparent', 'great_grandchild', 'great_grandparent', 
    'grandson', 'granddaughter', 'great_grandson', 'great_granddaughter',
    'nephew', 'niece', 'cousin', 'uncle', 'aunt', 'in_law', 'other'
  );
  
  -- Drop constraint if it exists
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

-- Family relationships table for complex family trees
CREATE TABLE IF NOT EXISTS family_relationships (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  parent_contact_id uuid REFERENCES contacts(id) ON DELETE CASCADE,
  child_contact_id uuid REFERENCES contacts(id) ON DELETE CASCADE,
  relationship_type text NOT NULL,
  created_at timestamptz DEFAULT now(),
  UNIQUE(parent_contact_id, child_contact_id)
);

-- Add contact_id to lead_required_documents if it doesn't exist
ALTER TABLE lead_required_documents ADD COLUMN IF NOT EXISTS contact_id uuid REFERENCES contacts(id) ON DELETE CASCADE;

-- Contact document status tracking
CREATE TABLE IF NOT EXISTS contact_document_status (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  contact_id uuid REFERENCES contacts(id) ON DELETE CASCADE,
  document_type text NOT NULL,
  status text DEFAULT 'missing',
  file_path text,
  upload_date timestamptz,
  verified_date timestamptz,
  verified_by uuid,
  notes text,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- Contact communications log
CREATE TABLE IF NOT EXISTS contact_communications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  contact_id uuid REFERENCES contacts(id) ON DELETE CASCADE,
  communication_type text NOT NULL, -- 'email', 'phone', 'meeting', 'document'
  subject text,
  content text,
  direction text, -- 'inbound', 'outbound'
  status text DEFAULT 'sent',
  sent_at timestamptz DEFAULT now(),
  read_at timestamptz,
  created_by uuid,
  created_at timestamptz DEFAULT now()
);

-- Emergency contacts
CREATE TABLE IF NOT EXISTS emergency_contacts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  contact_id uuid REFERENCES contacts(id) ON DELETE CASCADE,
  name text NOT NULL,
  relationship text,
  phone text,
  email text,
  address text,
  is_primary boolean DEFAULT false,
  created_at timestamptz DEFAULT now()
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_contacts_lead_id ON contacts(lead_id);
CREATE INDEX IF NOT EXISTS idx_contacts_relationship ON contacts(relationship);
CREATE INDEX IF NOT EXISTS idx_contacts_is_main_applicant ON contacts(is_main_applicant);
CREATE INDEX IF NOT EXISTS idx_contacts_is_persecuted ON contacts(is_persecuted);
CREATE INDEX IF NOT EXISTS idx_lead_required_documents_contact_id ON lead_required_documents(contact_id);
CREATE INDEX IF NOT EXISTS idx_contact_document_status_contact_id ON contact_document_status(contact_id);

-- Trigger to update updated_at timestamp
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER update_contacts_updated_at 
  BEFORE UPDATE ON contacts 
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_contact_document_status_updated_at 
  BEFORE UPDATE ON contact_document_status 
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Function to create default document requirements for a new contact
-- Only creates the 4 essential documents: Birth Certificate, Marriage Certificate, Passport Copy, Police Certificate
CREATE OR REPLACE FUNCTION create_default_documents_for_contact(
  p_lead_id uuid,
  p_contact_id uuid,
  p_relationship text DEFAULT 'persecuted_person'
)
RETURNS void AS $$
DECLARE
  template_record document_templates%ROWTYPE;
BEGIN
  -- Standard 4 documents for all applicants regardless of relationship
  FOR template_record IN 
    SELECT * FROM document_templates 
    WHERE name IN ('Birth Certificate', 'Marriage Certificate', 'Passport Copy', 'Police Certificate')
    AND is_active = true
  LOOP
    INSERT INTO lead_required_documents (
      lead_id, 
      contact_id,
      document_name, 
      document_type, 
      due_date,
      requested_by
    ) VALUES (
      p_lead_id,
      p_contact_id,
      template_record.name,
      template_record.category,
      now() + (template_record.typical_due_days || ' days')::interval,
      'system'
    );
  END LOOP;
END;
$$ LANGUAGE plpgsql;

-- Function to get document completion percentage for a contact
-- Drop existing function first to avoid return type conflicts
DROP FUNCTION IF EXISTS get_contact_document_completion(uuid);

CREATE OR REPLACE FUNCTION get_contact_document_completion(p_contact_id uuid)
RETURNS TABLE(
  total integer,
  completed integer,
  percentage numeric
) AS $$
BEGIN
  RETURN QUERY
  WITH doc_stats AS (
    SELECT 
      COUNT(*) as total,
      COUNT(CASE WHEN status IN ('received', 'approved') THEN 1 END) as completed
    FROM lead_required_documents 
    WHERE contact_id = p_contact_id
  )
  SELECT 
    total::integer,
    completed::integer,
    CASE 
      WHEN total > 0 THEN ROUND((completed::numeric / total::numeric) * 100, 1)
      ELSE 0
    END as percentage
  FROM doc_stats;
END;
$$ LANGUAGE plpgsql; 