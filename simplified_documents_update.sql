-- Simplified Document Requirements Update
-- This script updates existing contacts to have only the 4 required documents

-- Step 1: Remove all existing document requirements for handler-assigned leads
DELETE FROM lead_required_documents 
WHERE lead_id IN (SELECT id FROM leads WHERE stage = 'handler_assigned');

-- Step 2: Add only the 4 required documents for each existing contact
INSERT INTO lead_required_documents (lead_id, contact_id, document_name, document_type, due_date, requested_by)
SELECT 
  c.lead_id,
  c.id as contact_id,
  dt.name as document_name,
  dt.category as document_type,
  now() + (dt.typical_due_days || ' days')::interval as due_date,
  'system' as requested_by
FROM contacts c
CROSS JOIN document_templates dt
WHERE c.lead_id IN (SELECT id FROM leads WHERE stage = 'handler_assigned')
AND dt.name IN ('Birth Certificate', 'Marriage Certificate', 'Passport Copy', 'Police Certificate')
AND dt.is_active = true;

-- Step 3: Update the function for future contacts
CREATE OR REPLACE FUNCTION create_default_documents_for_contact(
  p_lead_id uuid,
  p_contact_id uuid,
  p_relationship text DEFAULT 'persecuted_person'
)
RETURNS void AS $$
DECLARE
  template_record document_templates%ROWTYPE;
BEGIN
  -- Standard 4 documents for all applicants
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

-- Verification query - show document count per contact
SELECT 
  c.name as contact_name,
  c.relationship,
  COUNT(lrd.id) as document_count,
  STRING_AGG(lrd.document_name, ', ' ORDER BY lrd.document_name) as documents
FROM contacts c
LEFT JOIN lead_required_documents lrd ON c.id = lrd.contact_id
WHERE c.lead_id IN (SELECT id FROM leads WHERE stage = 'handler_assigned')
GROUP BY c.id, c.name, c.relationship
ORDER BY c.name; 