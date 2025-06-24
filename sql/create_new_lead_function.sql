-- Drop existing function if it exists
DROP FUNCTION IF EXISTS create_new_lead(text, text, text, text, text);

-- Create function to create a new lead with automatic lead number generation
CREATE OR REPLACE FUNCTION create_new_lead(
  lead_name text,
  lead_email text DEFAULT NULL,
  lead_phone text DEFAULT NULL,
  lead_topic text DEFAULT NULL,
  lead_language text DEFAULT 'English'
)
RETURNS TABLE(
  id integer,
  lead_number text,
  name text,
  email text
) AS $$
DECLARE
  new_lead_number text;
  new_lead_id integer;
BEGIN
  -- Generate a new lead number (L + current timestamp)
  new_lead_number := 'L' || to_char(now(), 'YYYYMMDDHH24MISS');
  
  -- Insert the new lead
  INSERT INTO leads (
    lead_number,
    name,
    email,
    phone,
    topic,
    language,
    source,
    stage,
    status,
    created_at
  ) VALUES (
    new_lead_number,
    lead_name,
    lead_email,
    lead_phone,
    lead_topic,
    lead_language,
    'Manual',
    'created',
    'new',
    now()
  ) RETURNING id INTO new_lead_id;
  
  -- Return the created lead information
  RETURN QUERY
  SELECT 
    l.id,
    l.lead_number,
    l.name,
    l.email
  FROM leads l
  WHERE l.id = new_lead_id;
END;
$$ LANGUAGE plpgsql; 