-- Create a complete function for creating new leads that:
-- 1. Syncs sequences to prevent duplicate key errors
-- 2. Checks both leads and leads_lead tables for lead number continuity
-- 3. Creates the lead (contact and relationship are created automatically by trigger trg_auto_create_main_contact)
-- 
-- Usage: Call create_new_lead_v4 instead of create_new_lead_v3
-- This ensures lead numbers are always one higher than the highest ID in leads_lead table
-- 
-- Note: Contact creation is handled by the trigger to prevent duplicate contacts

CREATE OR REPLACE FUNCTION create_new_lead_v4(
  p_lead_name TEXT,
  p_lead_email TEXT DEFAULT NULL,
  p_lead_phone TEXT DEFAULT NULL,
  p_lead_topic TEXT DEFAULT NULL,
  p_lead_language TEXT DEFAULT NULL,
  p_lead_source TEXT DEFAULT NULL,
  p_created_by TEXT DEFAULT NULL,
  p_balance_currency TEXT DEFAULT 'NIS',
  p_proposal_currency TEXT DEFAULT 'NIS'
)
RETURNS TABLE (
  id UUID,
  lead_number TEXT,
  name TEXT,
  email TEXT
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_new_lead_number TEXT;
  v_new_lead_id UUID;
  v_creator_full_name TEXT;
  v_last_lead_number TEXT;
  v_last_leads_lead_id BIGINT;
  v_max_number BIGINT;
  v_next_number BIGINT;
BEGIN
  -- Sync leads_contact sequence to prevent duplicate key errors
  PERFORM setval(
    'leads_contact_id_seq',
    COALESCE((SELECT MAX(leads_contact.id) FROM leads_contact), 1),
    true
  );
  
  -- Sync lead_leadcontact sequence to prevent duplicate key errors
  PERFORM setval(
    'lead_leadcontact_id_seq',
    COALESCE((SELECT MAX(lead_leadcontact.id) FROM lead_leadcontact), 1),
    true
  );
  
  -- Get the last lead number from leads table (L-prefixed numbers)
  SELECT l.lead_number INTO v_last_lead_number
  FROM leads l
  WHERE l.lead_number ~ '^L[0-9]+$'
  ORDER BY CAST(SUBSTRING(l.lead_number FROM 2) AS BIGINT) DESC
  LIMIT 1;
  
  -- Get the highest ID from leads_lead table (legacy table)
  SELECT COALESCE(MAX(leads_lead.id), 0) INTO v_last_leads_lead_id
  FROM leads_lead;
  
  -- Calculate the maximum number from both sources
  IF v_last_lead_number IS NOT NULL THEN
    v_max_number := GREATEST(
      v_last_leads_lead_id,
      CAST(SUBSTRING(v_last_lead_number FROM 2) AS BIGINT)
    );
  ELSE
    v_max_number := v_last_leads_lead_id;
  END IF;
  
  -- Generate the next number (one higher than the maximum)
  v_next_number := v_max_number + 1;
  
  -- Generate the new lead number with L prefix
  v_new_lead_number := 'L' || v_next_number::TEXT;
  
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
    created_by_full_name,
    balance_currency,
    proposal_currency
  ) VALUES (
    v_new_lead_number,
    p_lead_name,
    p_lead_email,
    p_lead_phone,
    p_lead_topic,
    p_lead_language,
    p_lead_source,
    0::BIGINT, -- Stage 0 = Created
    'active',
    NOW(),
    p_created_by,
    v_creator_full_name,
    p_balance_currency,
    p_proposal_currency
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
$$;

-- Grant execute permission to authenticated users
GRANT EXECUTE ON FUNCTION create_new_lead_v4 TO authenticated;

