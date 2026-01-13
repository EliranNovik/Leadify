-- Create a function to update lead stage for public contract signing (LEGACY LEADS in new contracts table)
-- This function bypasses RLS using SECURITY DEFINER to allow unauthenticated users
-- to update the lead stage when signing a contract via public link for legacy leads in the new contracts table

-- Drop any existing versions with different signatures to avoid conflicts
DROP FUNCTION IF EXISTS public.update_lead_stage_for_public_contract_legacy_in_contracts(UUID, TEXT, BIGINT);

CREATE OR REPLACE FUNCTION public.update_lead_stage_for_public_contract_legacy_in_contracts(
  p_contract_id UUID,
  p_public_token TEXT,
  p_stage BIGINT DEFAULT 60
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_contract_exists BOOLEAN;
  v_legacy_id BIGINT;
  v_timestamp TIMESTAMP WITH TIME ZONE;
  v_stage_record_id BIGINT;
  v_lead_updated BOOLEAN;
  v_stage_exists BOOLEAN;
BEGIN
  -- Verify that the contract exists and has the correct public_token
  SELECT EXISTS(
    SELECT 1 
    FROM contracts 
    WHERE id = p_contract_id 
    AND public_token = p_public_token
    AND public_token IS NOT NULL
    AND legacy_id IS NOT NULL
  ) INTO v_contract_exists;
  
  IF NOT v_contract_exists THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'Invalid contract or token. Contract may not have a public_token or legacy_id set.'
    );
  END IF;
  
  -- Get legacy_id from the contract (explicitly cast to BIGINT)
  SELECT CAST(legacy_id AS BIGINT) INTO v_legacy_id
  FROM contracts
  WHERE id = p_contract_id 
    AND public_token = p_public_token
    AND public_token IS NOT NULL
    AND legacy_id IS NOT NULL;
  
  IF v_legacy_id IS NULL THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'Contract does not have a legacy_id'
    );
  END IF;
  
  -- Get current timestamp
  v_timestamp := NOW();
  
  -- Step 1: Ensure stage exists in lead_stages table (for FK validation)
  -- lead_stages.id is BIGINT, so insert as BIGINT
  INSERT INTO lead_stages (id, name)
  VALUES (p_stage, 'Client signed agreement')
  ON CONFLICT (id) DO NOTHING;
  
  -- Step 2: Insert into leads_leadstage table with lead_id (for legacy leads)
  INSERT INTO leads_leadstage (
    lead_id,
    stage,
    date,
    cdate,
    udate,
    creator_id
  ) VALUES (
    v_legacy_id,
    p_stage,  -- Use p_stage (BIGINT) instead of hardcoded 60
    v_timestamp,
    v_timestamp,
    v_timestamp,
    NULL  -- No creator for public contract signing
  )
  RETURNING id INTO v_stage_record_id;
  
  -- Step 3: Update the lead's stage in leads_lead table
  -- Use a variable to ensure proper type handling
  -- Direct update - PostgreSQL should handle BIGINT to BIGINT assignment
  UPDATE leads_lead
  SET stage = p_stage
  WHERE id = v_legacy_id;
  
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
    'legacy_id', v_legacy_id,
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
GRANT EXECUTE ON FUNCTION public.update_lead_stage_for_public_contract_legacy_in_contracts(UUID, TEXT, BIGINT) TO anon;
GRANT EXECUTE ON FUNCTION public.update_lead_stage_for_public_contract_legacy_in_contracts(UUID, TEXT, BIGINT) TO authenticated;

-- Add comment
COMMENT ON FUNCTION public.update_lead_stage_for_public_contract_legacy_in_contracts IS 
'Updates lead stage to 60 (Client signed agreement) for public contract signing of LEGACY LEADS in the new contracts table. Bypasses RLS using SECURITY DEFINER. Requires valid public_token for security.';
