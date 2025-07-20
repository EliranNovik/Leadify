CREATE TABLE IF NOT EXISTS proformas (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  contract_id UUID REFERENCES contracts(id),
  client_id UUID REFERENCES clients(id),
  amount NUMERIC,
  due_date DATE,
  currency TEXT,
  status TEXT DEFAULT 'pending',
  created_at TIMESTAMP DEFAULT now()
); 