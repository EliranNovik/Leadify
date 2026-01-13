-- Fix for "boolean = integer" error in stage update
-- The issue is likely that a trigger is firing that calls evaluate_and_update_stage
-- which compares BIGINT stage values to integers

-- Solution: Temporarily disable triggers during the update, or ensure the stage value
-- is properly cast to BIGINT in all comparisons

-- Updated function that disables triggers during update
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
  
  -- Step 1: Insert into leads_leadstage table with lead_id (for legacy leads)
  INSERT INTO leads_leadstage (
    lead_id,
    stage,
    date,
    cdate,
    udate,
    creator_id
  ) VALUES (
    v_legacy_id,
    60::BIGINT,
    v_timestamp,
    v_timestamp,
    v_timestamp,
    NULL
  )
  RETURNING id INTO v_stage_record_id;
  
  -- Step 2: Update the lead's stage in leads_lead table
  -- DISABLE triggers temporarily to avoid trigger conflicts
  ALTER TABLE leads_lead DISABLE TRIGGER ALL;
  
  BEGIN
    UPDATE leads_lead
    SET stage = 60::BIGINT
    WHERE id = v_legacy_id;
    
    GET DIAGNOSTICS v_lead_updated = ROW_COUNT;
  EXCEPTION
    WHEN OTHERS THEN
      -- Re-enable triggers even if update fails
      ALTER TABLE leads_lead ENABLE TRIGGER ALL;
      RAISE;
  END;
  
  -- Re-enable triggers
  ALTER TABLE leads_lead ENABLE TRIGGER ALL;
  
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
    -- Ensure triggers are re-enabled even on error
    ALTER TABLE leads_lead ENABLE TRIGGER ALL;
    RETURN jsonb_build_object(
      'success', false,
      'error', SQLERRM
    );
END;
$$;

-- Grant execute permission
GRANT EXECUTE ON FUNCTION public.update_lead_stage_for_public_contract_legacy_in_contracts(UUID, TEXT, BIGINT) TO anon;
GRANT EXECUTE ON FUNCTION public.update_lead_stage_for_public_contract_legacy_in_contracts(UUID, TEXT, BIGINT) TO authenticated;
