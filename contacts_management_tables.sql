-- Contacts and Family Members Management Tables for Handler Dashboard

-- Main contacts table - extends existing contacts functionality
-- This assumes you already have a contacts table, so we'll add columns if needed
-- If contacts table doesn't exist, create it:

CREATE TABLE IF NOT EXISTS contacts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id uuid REFERENCES leads(id) ON DELETE CASCADE,
  name text NOT NULL,
  email text,
  phone text,
  relationship text, -- 'main_applicant', 'spouse', 'child', 'parent', 'sibling', 'other'
  birth_date date,
  death_date date, -- for deceased family members
  birth_place text,
  current_address text,
  citizenship text,
  passport_number text,
  id_number text,
  is_main_applicant boolean DEFAULT false,
  is_persecuted boolean DEFAULT false,
  persecution_details jsonb, -- detailed persecution information
  contact_notes text,
  document_status text DEFAULT 'pending', -- overall document status for this contact
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- Add columns to existing contacts table if they don't exist
ALTER TABLE contacts ADD COLUMN IF NOT EXISTS lead_id uuid REFERENCES leads(id) ON DELETE CASCADE;
ALTER TABLE contacts ADD COLUMN IF NOT EXISTS relationship text DEFAULT 'main_applicant';
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

-- Family relationships table - for complex family trees
CREATE TABLE family_relationships (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id uuid REFERENCES leads(id) ON DELETE CASCADE,
  contact_id uuid REFERENCES contacts(id) ON DELETE CASCADE,
  related_contact_id uuid REFERENCES contacts(id) ON DELETE CASCADE,
  relationship_type text NOT NULL, -- 'parent', 'child', 'spouse', 'sibling'
  is_biological boolean DEFAULT true,
  created_at timestamptz DEFAULT now()
);

-- Contact documents - link documents to specific contacts
-- Update the existing lead_required_documents to include contact_id
ALTER TABLE lead_required_documents ADD COLUMN IF NOT EXISTS contact_id uuid REFERENCES contacts(id) ON DELETE CASCADE;

-- Contact document status tracking
CREATE TABLE contact_document_status (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  contact_id uuid REFERENCES contacts(id) ON DELETE CASCADE,
  required_document_id uuid REFERENCES lead_required_documents(id) ON DELETE CASCADE,
  status text DEFAULT 'missing' CHECK (status IN ('missing', 'pending', 'received', 'approved', 'rejected')),
  notes text,
  last_updated timestamptz DEFAULT now(),
  updated_by text
);

-- Contact communication history
CREATE TABLE contact_communications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  contact_id uuid REFERENCES contacts(id) ON DELETE CASCADE,
  communication_type text NOT NULL, -- 'email', 'phone', 'meeting', 'document_request'
  subject text,
  content text,
  sent_at timestamptz DEFAULT now(),
  sent_by text NOT NULL,
  status text DEFAULT 'sent' CHECK (status IN ('sent', 'delivered', 'read', 'replied')),
  response text,
  response_at timestamptz
);

-- Emergency contacts for family members
CREATE TABLE emergency_contacts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  contact_id uuid REFERENCES contacts(id) ON DELETE CASCADE,
  name text NOT NULL,
  relationship text,
  phone text,
  email text,
  address text,
  created_at timestamptz DEFAULT now()
);

-- Create indexes for better performance
CREATE INDEX IF NOT EXISTS idx_contacts_lead_id ON contacts(lead_id);
CREATE INDEX IF NOT EXISTS idx_contacts_relationship ON contacts(relationship);
CREATE INDEX IF NOT EXISTS idx_contacts_is_main_applicant ON contacts(is_main_applicant);
CREATE INDEX IF NOT EXISTS idx_contacts_document_status ON contacts(document_status);
CREATE INDEX IF NOT EXISTS idx_family_relationships_lead_id ON family_relationships(lead_id);
CREATE INDEX IF NOT EXISTS idx_family_relationships_contact_id ON family_relationships(contact_id);
CREATE INDEX IF NOT EXISTS idx_contact_document_status_contact_id ON contact_document_status(contact_id);
CREATE INDEX IF NOT EXISTS idx_contact_communications_contact_id ON contact_communications(contact_id);
CREATE INDEX IF NOT EXISTS idx_emergency_contacts_contact_id ON emergency_contacts(contact_id);
CREATE INDEX IF NOT EXISTS idx_lead_required_documents_contact_id ON lead_required_documents(contact_id);

-- Function to automatically update updated_at timestamp for contacts
CREATE OR REPLACE FUNCTION update_contacts_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Trigger to automatically update updated_at for contacts
DROP TRIGGER IF EXISTS trigger_update_contacts_updated_at ON contacts;
CREATE TRIGGER trigger_update_contacts_updated_at
  BEFORE UPDATE ON contacts
  FOR EACH ROW
  EXECUTE FUNCTION update_contacts_updated_at();

-- Function to create default document requirements for a new contact
CREATE OR REPLACE FUNCTION create_default_documents_for_contact(
  p_lead_id uuid,
  p_contact_id uuid,
  p_relationship text DEFAULT 'persecuted_person'
)
RETURNS void AS $$
DECLARE
  template_record document_templates%ROWTYPE;
  doc_names text[];
BEGIN
  -- Standard document requirements for all applicants regardless of relationship
  doc_names := ARRAY['Birth Certificate', 'Marriage Certificate', 'Passport Copy', 'Police Certificate'];

  -- Create required documents for this contact
  FOR template_record IN 
    SELECT * FROM document_templates 
    WHERE name = ANY(doc_names)
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

-- Function to calculate document completion percentage for a contact
CREATE OR REPLACE FUNCTION get_contact_document_completion(p_contact_id uuid)
RETURNS TABLE(
  total_docs integer,
  completed_docs integer,
  completion_percentage numeric
) AS $$
BEGIN
  RETURN QUERY
  WITH doc_stats AS (
    SELECT 
      COUNT(*) as total,
      COUNT(CASE WHEN status IN ('approved', 'received') THEN 1 END) as completed
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

-- No sample data - clean installation 