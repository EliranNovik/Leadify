CREATE TABLE IF NOT EXISTS contracts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id UUID REFERENCES clients(id),
  template_id UUID REFERENCES contract_templates(id),
  applicant_count INTEGER,
  total_amount NUMERIC,
  status TEXT DEFAULT 'draft',
  client_country TEXT,
  signed_at TIMESTAMP,
  created_at TIMESTAMP DEFAULT now(),
  updated_at TIMESTAMP DEFAULT now()
); 