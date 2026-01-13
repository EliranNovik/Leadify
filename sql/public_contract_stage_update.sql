-- Create a function to update lead stage for public contract signing
-- This function bypasses RLS using SECURITY DEFINER to allow unauthenticated users
-- to update the lead stage when signing a contract via public link

CREATE OR REPLACE FUNCTION public.update_lead_stage_for_public_contract(
  p_lead_id BIGINT,
  p_stage INTEGER,
  p_public_token TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_contract_exists BOOLEAN;
  v_timestamp TIMESTAMP WITH TIME ZONE;
  v_stage_record_id BIGINT;
  v_lead_updated BOOLEAN;
BEGIN
  -- Verify that the contract exists and has the correct public_token
  SELECT EXISTS(
    SELECT 1 
    FROM lead_leadcontact 
    WHERE lead_id = p_lead_id 
    AND public_token = p_public_token
  ) INTO v_contract_exists;
  
  IF NOT v_contract_exists THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'Invalid contract or token'
    );
  END IF;
  
  -- Get current timestamp
  v_timestamp := NOW();
  
  -- Step 1: Insert into leads_leadstage table
  INSERT INTO leads_leadstage (
    lead_id,
    stage,
    date,
    cdate,
    udate,
    creator_id
  ) VALUES (
    p_lead_id,
    p_stage,
    v_timestamp,
    v_timestamp,
    v_timestamp,
    NULL  -- No creator for public contract signing
  )
  RETURNING id INTO v_stage_record_id;
  
  -- Step 2: Update the lead's stage in leads_lead table
  UPDATE leads_lead
  SET 
    stage = p_stage,
    stage_changed_by = 'Public Contract Signing',
    stage_changed_at = v_timestamp
  WHERE id = p_lead_id;
  
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
    'lead_id', p_lead_id,
    'stage', p_stage,
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
GRANT EXECUTE ON FUNCTION public.update_lead_stage_for_public_contract(BIGINT, INTEGER, TEXT) TO anon;
GRANT EXECUTE ON FUNCTION public.update_lead_stage_for_public_contract(BIGINT, INTEGER, TEXT) TO authenticated;

-- Add comment
COMMENT ON FUNCTION public.update_lead_stage_for_public_contract IS 
'Updates lead stage to 60 (Client signed agreement) for public contract signing. Bypasses RLS using SECURITY DEFINER. Requires valid public_token for security.';
