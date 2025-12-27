-- Drop existing function if it exists
DROP FUNCTION IF EXISTS create_lead_with_source_validation(text, text, text, text, text, text, text, integer, text, text);

-- Create function to create a new lead with source validation and default values
CREATE OR REPLACE FUNCTION create_lead_with_source_validation(
  p_lead_name text,
  p_lead_email text DEFAULT NULL,
  p_lead_phone text DEFAULT NULL,
  p_lead_topic text DEFAULT NULL,
  p_lead_language text DEFAULT 'EN',
  p_lead_source text DEFAULT 'Webhook',
  p_created_by text DEFAULT NULL,
  p_source_code integer DEFAULT NULL,
  p_balance_currency text DEFAULT 'NIS',
  p_proposal_currency text DEFAULT 'NIS'
)
RETURNS TABLE(
  id uuid,
  lead_number text,
  name text,
  email text,
  source_id bigint,
  source_name text,
  final_topic text,
  final_category_id bigint
) AS $$
DECLARE
  v_new_lead_number text;
  v_new_lead_id uuid;
  v_creator_full_name text;
  v_last_lead_number text;
  v_next_number bigint;
  v_source_record record;
  v_final_topic text;
  v_final_category_id bigint;
  v_source_id bigint;
  v_source_name text;
  v_last_leads_lead_id bigint;
  v_last_leads_number text;
  v_max_number bigint;
  v_language_id uuid;
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
  
  -- Validate source code if provided
  IF p_source_code IS NOT NULL THEN
    -- Get source information
    SELECT mls.id, mls.name, mls.active, mls.default_topic, mls.default_category_id
    INTO v_source_record
    FROM misc_leadsource mls
    WHERE mls.code = p_source_code;
    
    -- Check if source exists
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Source code % not found in misc_leadsource table', p_source_code;
    END IF;
    
    -- Check if source is active
    IF NOT v_source_record.active THEN
      RAISE EXCEPTION 'Lead source with code % is inactive', p_source_code;
    END IF;
    
    -- Set source information
    v_source_id := v_source_record.id;
    v_source_name := v_source_record.name;
    
    -- Determine final topic (use default_topic if provided, otherwise use passed topic)
    v_final_topic := COALESCE(v_source_record.default_topic, p_lead_topic);
    
    -- Set the category_id from the source's default_category_id
    v_final_category_id := v_source_record.default_category_id;
    
  ELSE
    -- No source code provided, use defaults
    v_source_id := NULL;
    v_source_name := p_lead_source;
    v_final_topic := p_lead_topic;
    v_final_category_id := NULL;
  END IF;
  
  -- Get the last lead number from both tables to avoid conflicts
  -- Get the last ID from leads_lead table (cast to bigint to avoid overflow)
  SELECT COALESCE(MAX(ll.id)::bigint, 0) INTO v_last_leads_lead_id
  FROM leads_lead ll;
  
  -- Get the last L-prefixed number from leads table
  SELECT l.lead_number INTO v_last_leads_number
  FROM leads l
  WHERE l.lead_number ~ '^L[0-9]+$'
  ORDER BY CAST(SUBSTRING(l.lead_number FROM 2) AS bigint) DESC
  LIMIT 1;
  
  -- Calculate the maximum number from both sources
  IF v_last_leads_number IS NOT NULL THEN
    v_max_number := GREATEST(v_last_leads_lead_id, CAST(SUBSTRING(v_last_leads_number FROM 2) AS bigint));
  ELSE
    v_max_number := v_last_leads_lead_id;
  END IF;
  
  -- Generate the next number
  v_next_number := v_max_number + 1;
  
  -- Generate the new lead number with L prefix
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
  
  -- Look up language_id from languages table
  -- Try to match by name first (case-insensitive), then by iso_code
  IF p_lead_language IS NOT NULL THEN
    SELECT l.id INTO v_language_id
    FROM languages l
    WHERE l.is_active = true
      AND (
        UPPER(l.name) = UPPER(p_lead_language)
        OR UPPER(l.iso_code) = UPPER(p_lead_language)
      )
    LIMIT 1;
  END IF;
  
  -- If language not found, default to 'EN'
  IF v_language_id IS NULL THEN
    SELECT l.id INTO v_language_id
    FROM languages l
    WHERE l.is_active = true
      AND (UPPER(l.name) = 'EN' OR UPPER(l.iso_code) = 'EN')
    LIMIT 1;
  END IF;
  
  -- Insert the new lead with user tracking and source information
  INSERT INTO leads (
    lead_number,
    name,
    email,
    phone,
    topic,
    language_id,
    source,
    source_id,
    category_id,
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
    v_final_topic,
    v_language_id,
    v_source_name,
    v_source_id,
    v_final_category_id,
    0::BIGINT, -- Stage 0 = Created
    'active',
    now(),
    p_created_by,
    v_creator_full_name,
    p_balance_currency,
    p_proposal_currency
  ) RETURNING leads.id INTO v_new_lead_id;
  
  -- Note: Contact creation is handled automatically by the trigger trg_auto_create_main_contact
  -- The trigger will create the contact in leads_contact and the relationship in lead_leadcontact
  
  -- Return the created lead information
  RETURN QUERY
  SELECT 
    l.id AS id,
    l.lead_number AS lead_number,
    l.name AS name,
    l.email AS email,
    v_source_id AS source_id,
    l.source AS source_name,
    l.topic AS final_topic,
    v_final_category_id AS final_category_id
  FROM leads l
  WHERE l.id = v_new_lead_id;
END;
$$ LANGUAGE plpgsql;
