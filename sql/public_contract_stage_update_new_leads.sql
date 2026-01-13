-- Create a function to update lead stage for public contract signing (NEW LEADS)
-- This function bypasses RLS using SECURITY DEFINER to allow unauthenticated users
-- to update the lead stage when signing a contract via public link for new leads

-- Drop any existing versions with different signatures to avoid conflicts
DROP FUNCTION IF EXISTS public.update_lead_stage_for_public_contract_new(UUID, TEXT, TEXT);

CREATE OR REPLACE FUNCTION public.update_lead_stage_for_public_contract_new(
  p_contract_id UUID,
  p_public_token TEXT,
  p_stage TEXT DEFAULT 'Client signed agreement'
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_contract_exists BOOLEAN;
  v_client_id UUID;
  v_timestamp TIMESTAMP WITH TIME ZONE;
  v_stage_record_id BIGINT;
  v_lead_updated BOOLEAN;
  v_resolved_stage_id BIGINT;
BEGIN
  -- Verify that the contract exists and has the correct public_token
  SELECT EXISTS(
    SELECT 1 
    FROM contracts 
    WHERE id = p_contract_id 
    AND public_token = p_public_token
    AND public_token IS NOT NULL
  ) INTO v_contract_exists;
  
  IF NOT v_contract_exists THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'Invalid contract or token. Contract may not have a public_token set.'
    );
  END IF;
  
  -- Get client_id from the contract
  SELECT client_id INTO v_client_id
  FROM contracts
  WHERE id = p_contract_id 
    AND public_token = p_public_token
    AND public_token IS NOT NULL;
  
  IF v_client_id IS NULL THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'Contract does not have a client_id'
    );
  END IF;
  
  -- Resolve stage text to stage ID (60 for "Client signed agreement")
  -- For new leads, stage is stored as text, but we need to map it to the numeric stage ID
  -- Note: leads_leadstage.stage is BIGINT, so we use BIGINT here
  IF p_stage = 'Client signed agreement' THEN
    v_resolved_stage_id := 60::BIGINT;
  ELSE
    -- Try to resolve other stage names if needed
    v_resolved_stage_id := 60::BIGINT; -- Default to 60 for contract signing
  END IF;
  
  -- Get current timestamp
  v_timestamp := NOW();
  
  -- Step 1: Insert into leads_leadstage table with newlead_id (for new leads)
  INSERT INTO leads_leadstage (
    newlead_id,
    stage,
    date,
    cdate,
    udate,
    creator_id
  ) VALUES (
    v_client_id,
    v_resolved_stage_id,
    v_timestamp,
    v_timestamp,
    v_timestamp,
    NULL  -- No creator for public contract signing
  )
  RETURNING id INTO v_stage_record_id;
  
  -- Step 2: Update the lead's stage in leads table
  UPDATE leads
  SET 
    stage = p_stage
  WHERE id = v_client_id;
  
  GET DIAGNOSTICS v_lead_updated = ROW_COUNT;
  
  IF v_lead_updated = 0 THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'Lead not found or could not be updated'
    );
  END IF;
  
  -- Return success
  RETURN jsonb_build_object(
    'success', true,
    'stage_record_id', v_stage_record_id,
    'client_id', v_client_id,
    'stage', v_resolved_stage_id,
    'stage_text', p_stage,
    'timestamp', v_timestamp
  );
  
EXCEPTION
  WHEN OTHERS THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', SQLERRM
    );
END;
$$;

-- Grant execute permission to anon (unauthenticated) users
GRANT EXECUTE ON FUNCTION public.update_lead_stage_for_public_contract_new(UUID, TEXT, TEXT) TO anon;
GRANT EXECUTE ON FUNCTION public.update_lead_stage_for_public_contract_new(UUID, TEXT, TEXT) TO authenticated;

-- Add comment
COMMENT ON FUNCTION public.update_lead_stage_for_public_contract_new IS 
'Updates lead stage to "Client signed agreement" (stage 60) for public contract signing of NEW LEADS. Bypasses RLS using SECURITY DEFINER. Requires valid public_token for security.';
