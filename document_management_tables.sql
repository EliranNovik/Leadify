-- Document Management Tables for Handler Dashboard

-- Required documents table - defines what documents are needed per lead
CREATE TABLE lead_required_documents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id uuid REFERENCES leads(id) ON DELETE CASCADE,
  document_name text NOT NULL,
  document_type text NOT NULL, -- 'birth_certificate', 'passport', 'police_record', etc.
  is_required boolean DEFAULT true,
  status text DEFAULT 'missing' CHECK (status IN ('missing', 'pending', 'received', 'approved', 'rejected')),
  notes text,
  due_date timestamptz,
  requested_date timestamptz DEFAULT now(),
  received_date timestamptz,
  approved_date timestamptz,
  requested_by text,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- Document files table - tracks actual uploaded files
CREATE TABLE document_files (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  required_document_id uuid REFERENCES lead_required_documents(id) ON DELETE CASCADE,
  lead_id uuid REFERENCES leads(id) ON DELETE CASCADE,
  file_name text NOT NULL,
  file_url text NOT NULL,
  file_size integer,
  file_type text, -- 'pdf', 'jpg', 'png', etc.
  uploaded_by text NOT NULL,
  uploaded_at timestamptz DEFAULT now(),
  is_valid boolean DEFAULT true,
  validation_notes text
);

-- Document templates table - predefined document types
CREATE TABLE document_templates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL UNIQUE,
  category text NOT NULL, -- 'identity', 'civil_status', 'legal', 'financial', etc.
  description text,
  is_active boolean DEFAULT true,
  typical_due_days integer DEFAULT 30, -- typical days to collect this document
  instructions text, -- instructions for client on how to obtain
  created_at timestamptz DEFAULT now()
);

-- Document comments/history table
CREATE TABLE document_comments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  required_document_id uuid REFERENCES lead_required_documents(id) ON DELETE CASCADE,
  comment text NOT NULL,
  comment_type text DEFAULT 'note' CHECK (comment_type IN ('note', 'status_change', 'request', 'reminder')),
  created_by text NOT NULL,
  created_at timestamptz DEFAULT now(),
  is_internal boolean DEFAULT true -- true for internal notes, false for client-visible
);

-- Create indexes for better performance
CREATE INDEX idx_lead_required_documents_lead_id ON lead_required_documents(lead_id);
CREATE INDEX idx_lead_required_documents_status ON lead_required_documents(status);
CREATE INDEX idx_lead_required_documents_due_date ON lead_required_documents(due_date);
CREATE INDEX idx_document_files_required_document_id ON document_files(required_document_id);
CREATE INDEX idx_document_files_lead_id ON document_files(lead_id);
CREATE INDEX idx_document_templates_category ON document_templates(category);
CREATE INDEX idx_document_comments_required_document_id ON document_comments(required_document_id);

-- Function to automatically update updated_at timestamp
CREATE OR REPLACE FUNCTION update_required_documents_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Trigger to automatically update updated_at
CREATE TRIGGER trigger_update_required_documents_updated_at
  BEFORE UPDATE ON lead_required_documents
  FOR EACH ROW
  EXECUTE FUNCTION update_required_documents_updated_at();

-- Insert common document templates
INSERT INTO document_templates (name, category, description, typical_due_days, instructions) VALUES
('Birth Certificate', 'identity', 'Official birth certificate from country of birth', 21, 'Contact civil registry in your birth country or city hall'),
('Marriage Certificate', 'civil_status', 'Official marriage certificate', 21, 'Contact the registry office where marriage was registered'),
('Death Certificate', 'civil_status', 'Official death certificate for deceased family members', 21, 'Contact civil registry or funeral home'),
('Police Certificate', 'legal', 'Criminal background check from all countries of residence', 30, 'Contact police authorities in each country where you lived for 6+ months'),
('Passport Copy', 'identity', 'Clear copy of current passport', 7, 'Scan or photograph all pages of your current passport'),
('Educational Documents', 'professional', 'Diplomas, transcripts, professional certificates', 14, 'Contact your educational institutions'),
('Employment Records', 'professional', 'Employment history and references', 14, 'Contact HR departments of previous employers'),
('Medical Records', 'health', 'Relevant medical documentation if required', 21, 'Contact your healthcare providers'),
('Financial Statements', 'financial', 'Bank statements, tax returns, proof of income', 14, 'Contact your bank and tax authority'),
('Military Records', 'legal', 'Military service records if applicable', 30, 'Contact military records office'),
('Persecution Evidence', 'legal', 'Documentation of persecution or discrimination', 45, 'Gather witness statements, police reports, news articles, or other evidence'),
('Property Documents', 'financial', 'Property ownership or rental agreements', 14, 'Contact property registry or landlord');

-- Function to create default required documents for a lead based on category
CREATE OR REPLACE FUNCTION create_default_documents_for_lead(
  p_lead_id uuid,
  p_category text DEFAULT 'citizenship' -- citizenship, visa, asylum, etc.
)
RETURNS void AS $$
DECLARE
  template_record document_templates%ROWTYPE;
BEGIN
  -- For citizenship applications, add common required documents
  IF p_category = 'citizenship' THEN
    FOR template_record IN 
      SELECT * FROM document_templates 
      WHERE name IN ('Birth Certificate', 'Marriage Certificate', 'Police Certificate', 'Passport Copy', 'Persecution Evidence')
      AND is_active = true
    LOOP
      INSERT INTO lead_required_documents (
        lead_id, 
        document_name, 
        document_type, 
        due_date,
        requested_by
      ) VALUES (
        p_lead_id,
        template_record.name,
        template_record.category,
        now() + (template_record.typical_due_days || ' days')::interval,
        'system'
      );
    END LOOP;
  END IF;
END;
$$ LANGUAGE plpgsql;

-- Sample data: Create default documents for existing handler-assigned leads
INSERT INTO lead_required_documents (lead_id, document_name, document_type, due_date, requested_by)
SELECT 
  id as lead_id,
  'Birth Certificate' as document_name,
  'identity' as document_type,
  now() + interval '21 days' as due_date,
  'system' as requested_by
FROM leads 
WHERE stage = 'handler_assigned'
LIMIT 3;

INSERT INTO lead_required_documents (lead_id, document_name, document_type, due_date, requested_by)
SELECT 
  id as lead_id,
  'Police Certificate' as document_name,
  'legal' as document_type,
  now() + interval '30 days' as due_date,
  'system' as requested_by
FROM leads 
WHERE stage = 'handler_assigned'
LIMIT 3; 