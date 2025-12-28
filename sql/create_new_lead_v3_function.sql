-- Drop existing function if it exists
DROP FUNCTION IF EXISTS create_new_lead_v3(text, text, text, text, text, text, text);

-- Create function to create a new lead with sequential numbering and user tracking
CREATE OR REPLACE FUNCTION create_new_lead_v3(
  p_lead_name text,
  p_lead_email text DEFAULT NULL,
  p_lead_phone text DEFAULT NULL,
  p_lead_topic text DEFAULT NULL,
  p_lead_language text DEFAULT 'English',
  p_lead_source text DEFAULT 'Manual',
  p_created_by text DEFAULT NULL
)
RETURNS TABLE(
  id uuid,
  lead_number text,
  name text,
  email text
) AS $$
DECLARE
  v_new_lead_number text;
  v_new_lead_id uuid;
  v_creator_full_name text;
  v_last_lead_number text;
  v_next_number integer;
BEGIN
  -- Get the last lead number from the database
  SELECT l.lead_number INTO v_last_lead_number
  FROM leads l
  WHERE l.lead_number ~ '^L[0-9]+$'
  ORDER BY CAST(SUBSTRING(l.lead_number FROM 2) AS integer) DESC
  LIMIT 1;
  
  -- If no lead numbers exist, start with L1, otherwise increment the last number
  IF v_last_lead_number IS NULL THEN
    v_next_number := 1;
  ELSE
    v_next_number := CAST(SUBSTRING(v_last_lead_number FROM 2) AS integer) + 1;
  END IF;
  
  -- Generate the new lead number
  v_new_lead_number := 'L' || v_next_number::text;
  
  -- Get the creator's full name from the users table
  IF p_created_by IS NOT NULL THEN
    SELECT u.full_name INTO v_creator_full_name 
    FROM users u
    WHERE u.email = p_created_by;
  END IF;
  
  -- If no full_name found, use the email as fallback
  IF v_creator_full_name IS NULL THEN
    v_creator_full_name := p_created_by;
  END IF;
  
  -- Insert the new lead with user tracking
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
    created_at,
    created_by,
    created_by_full_name
  ) VALUES (
    v_new_lead_number,
    p_lead_name,
    p_lead_email,
    p_lead_phone,
    p_lead_topic,
    p_lead_language,
    p_lead_source,
    'created',
    'new',
    now(),
    p_created_by,
    v_creator_full_name
  ) RETURNING leads.id INTO v_new_lead_id;
  
  -- Note: Contact creation is handled automatically by the trigger trg_auto_create_main_contact
  -- The trigger will create the contact in leads_contact and the relationship in lead_leadcontact
  -- This prevents duplicate contact creation
  
  -- Return the created lead information
  RETURN QUERY
  SELECT 
    l.id,
    l.lead_number,
    l.name,
    l.email
  FROM leads l
  WHERE l.id = v_new_lead_id;
END;
$$ LANGUAGE plpgsql; 