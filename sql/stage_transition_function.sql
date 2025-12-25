-- Stage Transition Logic as Database Function
-- This function evaluates and updates lead stages based on interaction history
-- Stage 11 (Precommunication): One-direction communication, no response, calls < 2 min
-- Stage 15 (Communication Started): Bidirectional communication + call > 2 min

CREATE OR REPLACE FUNCTION evaluate_and_update_stage(
  p_lead_id TEXT,
  p_is_legacy BOOLEAN
) RETURNS INTEGER AS $$
DECLARE
  v_current_stage BIGINT;
  v_table_name TEXT;
  v_id_field TEXT;
  v_client_id TEXT;
  v_has_outbound BOOLEAN := FALSE;
  v_has_inbound BOOLEAN := FALSE;
  v_has_call_over_2min BOOLEAN := FALSE;
  v_has_any_interaction BOOLEAN := FALSE;
  v_email_count INTEGER;
  v_whatsapp_count INTEGER;
  v_call_count INTEGER;
  v_legacy_interaction_count INTEGER;
  v_manual_interaction_count INTEGER;
  v_new_stage INTEGER;
  v_temp_has_outbound BOOLEAN := FALSE;
  v_temp_has_inbound BOOLEAN := FALSE;
  v_temp_has_call_over_2min BOOLEAN := FALSE;
BEGIN
  -- Debug logging
  RAISE NOTICE 'evaluate_and_update_stage called: p_lead_id=%, p_is_legacy=%', p_lead_id, p_is_legacy;
  
  -- Determine table and ID field
  IF p_is_legacy THEN
    v_table_name := 'leads_lead';
    v_id_field := 'id';
    v_client_id := p_lead_id;
  ELSE
    v_table_name := 'leads';
    v_id_field := 'id';
    v_client_id := p_lead_id;
  END IF;

  -- Get current stage
  BEGIN
    IF p_is_legacy THEN
      -- For legacy leads, v_client_id is numeric (BIGINT)
      EXECUTE format('SELECT stage FROM %I WHERE %I = $1', v_table_name, v_id_field)
        INTO v_current_stage
        USING v_client_id::BIGINT;
    ELSE
      -- For new leads, v_client_id is UUID
      EXECUTE format('SELECT stage FROM %I WHERE %I = $1', v_table_name, v_id_field)
        INTO v_current_stage
        USING v_client_id::UUID;
    END IF;
  EXCEPTION WHEN OTHERS THEN
    -- If query fails (e.g., invalid ID format), return 0
    RETURN 0;
  END;

  IF v_current_stage IS NULL THEN
    RAISE NOTICE 'Lead not found or stage is NULL: p_lead_id=%, p_is_legacy=%', p_lead_id, p_is_legacy;
    RETURN 0; -- Lead not found
  END IF;
  
  RAISE NOTICE 'Current stage: % for lead % (legacy: %)', v_current_stage, p_lead_id, p_is_legacy;

  -- Check emails
  IF p_is_legacy THEN
    SELECT COUNT(*) INTO v_email_count
    FROM emails
    WHERE legacy_id = v_client_id::BIGINT;
    
    IF v_email_count > 0 THEN
      v_has_any_interaction := TRUE;
      -- Check for outbound (OR with existing value)
      SELECT COUNT(*) > 0 INTO v_temp_has_outbound
      FROM emails
      WHERE legacy_id = v_client_id::BIGINT AND direction = 'outgoing';
      v_has_outbound := v_has_outbound OR COALESCE(v_temp_has_outbound, FALSE);
      -- Check for inbound (OR with existing value)
      SELECT COUNT(*) > 0 INTO v_temp_has_inbound
      FROM emails
      WHERE legacy_id = v_client_id::BIGINT AND direction = 'incoming';
      v_has_inbound := v_has_inbound OR COALESCE(v_temp_has_inbound, FALSE);
    END IF;
  ELSE
    SELECT COUNT(*) INTO v_email_count
    FROM emails
    WHERE client_id = v_client_id::UUID;
    
    IF v_email_count > 0 THEN
      v_has_any_interaction := TRUE;
      -- Check for outbound (OR with existing value)
      SELECT COUNT(*) > 0 INTO v_temp_has_outbound
      FROM emails
      WHERE client_id = v_client_id::UUID AND direction = 'outgoing';
      v_has_outbound := v_has_outbound OR COALESCE(v_temp_has_outbound, FALSE);
      -- Check for inbound (OR with existing value)
      SELECT COUNT(*) > 0 INTO v_temp_has_inbound
      FROM emails
      WHERE client_id = v_client_id::UUID AND direction = 'incoming';
      v_has_inbound := v_has_inbound OR COALESCE(v_temp_has_inbound, FALSE);
    END IF;
  END IF;

  -- Check WhatsApp messages
  IF p_is_legacy THEN
    SELECT COUNT(*) INTO v_whatsapp_count
    FROM whatsapp_messages
    WHERE legacy_id = v_client_id::BIGINT;
    
    IF v_whatsapp_count > 0 THEN
      v_has_any_interaction := TRUE;
      -- Check for outbound (OR with existing value)
      SELECT COUNT(*) > 0 INTO v_temp_has_outbound
      FROM whatsapp_messages
      WHERE legacy_id = v_client_id::BIGINT AND direction = 'out';
      v_has_outbound := v_has_outbound OR COALESCE(v_temp_has_outbound, FALSE);
      -- Check for inbound (OR with existing value)
      SELECT COUNT(*) > 0 INTO v_temp_has_inbound
      FROM whatsapp_messages
      WHERE legacy_id = v_client_id::BIGINT AND direction = 'in';
      v_has_inbound := v_has_inbound OR COALESCE(v_temp_has_inbound, FALSE);
    END IF;
  ELSE
    SELECT COUNT(*) INTO v_whatsapp_count
    FROM whatsapp_messages
    WHERE lead_id = v_client_id::UUID;
    
    IF v_whatsapp_count > 0 THEN
      v_has_any_interaction := TRUE;
      -- Check for outbound (OR with existing value)
      SELECT COUNT(*) > 0 INTO v_temp_has_outbound
      FROM whatsapp_messages
      WHERE lead_id = v_client_id::UUID AND direction = 'out';
      v_has_outbound := v_has_outbound OR COALESCE(v_temp_has_outbound, FALSE);
      -- Check for inbound (OR with existing value)
      SELECT COUNT(*) > 0 INTO v_temp_has_inbound
      FROM whatsapp_messages
      WHERE lead_id = v_client_id::UUID AND direction = 'in';
      v_has_inbound := v_has_inbound OR COALESCE(v_temp_has_inbound, FALSE);
    END IF;
  END IF;

  -- Check call_logs
  -- Note: call_logs.lead_id is typically BIGINT for legacy leads
  -- For new leads, it might not be used or might be stored differently
  IF p_is_legacy THEN
    SELECT COUNT(*) INTO v_call_count
    FROM call_logs
    WHERE lead_id::BIGINT = v_client_id::BIGINT;
    
    IF v_call_count > 0 THEN
      v_has_any_interaction := TRUE;
      -- Check for outbound (OR with existing value)
      SELECT COUNT(*) > 0 INTO v_temp_has_outbound
      FROM call_logs
      WHERE lead_id::BIGINT = v_client_id::BIGINT 
        AND (direction ILIKE '%outgoing%' OR direction = 'out');
      v_has_outbound := v_has_outbound OR COALESCE(v_temp_has_outbound, FALSE);
      -- Check for inbound (OR with existing value)
      SELECT COUNT(*) > 0 INTO v_temp_has_inbound
      FROM call_logs
      WHERE lead_id::BIGINT = v_client_id::BIGINT 
        AND (direction ILIKE '%incoming%' OR direction = 'in');
      v_has_inbound := v_has_inbound OR COALESCE(v_temp_has_inbound, FALSE);
      -- Check for calls over 2 minutes (120 seconds) (OR with existing value)
      SELECT COUNT(*) > 0 INTO v_temp_has_call_over_2min
      FROM call_logs
      WHERE lead_id::BIGINT = v_client_id::BIGINT 
        AND duration > 120;
      v_has_call_over_2min := v_has_call_over_2min OR COALESCE(v_temp_has_call_over_2min, FALSE);
    END IF;
  ELSE
    -- For new leads, call_logs.lead_id might be BIGINT or might not be set
    -- Try to match by converting to text and comparing
    -- Note: This might not work if call_logs doesn't store new lead IDs
    -- In that case, we rely on other interaction sources
    BEGIN
      SELECT COUNT(*) INTO v_call_count
      FROM call_logs
      WHERE lead_id::TEXT = v_client_id;
      
      IF v_call_count > 0 THEN
        v_has_any_interaction := TRUE;
        -- Check for outbound (OR with existing value)
        SELECT COUNT(*) > 0 INTO v_temp_has_outbound
        FROM call_logs
        WHERE lead_id::TEXT = v_client_id 
          AND (direction ILIKE '%outgoing%' OR direction = 'out');
        v_has_outbound := v_has_outbound OR COALESCE(v_temp_has_outbound, FALSE);
        -- Check for inbound (OR with existing value)
        SELECT COUNT(*) > 0 INTO v_temp_has_inbound
        FROM call_logs
        WHERE lead_id::TEXT = v_client_id 
          AND (direction ILIKE '%incoming%' OR direction = 'in');
        v_has_inbound := v_has_inbound OR COALESCE(v_temp_has_inbound, FALSE);
        -- Check for calls over 2 minutes (120 seconds) (OR with existing value)
        SELECT COUNT(*) > 0 INTO v_temp_has_call_over_2min
        FROM call_logs
        WHERE lead_id::TEXT = v_client_id 
          AND duration > 120;
        v_has_call_over_2min := v_has_call_over_2min OR COALESCE(v_temp_has_call_over_2min, FALSE);
      END IF;
    EXCEPTION WHEN OTHERS THEN
      -- If conversion fails, skip call_logs for new leads
      -- This is okay as we have other interaction sources
      NULL;
    END;
  END IF;

  -- Check leads_leadinteractions (legacy only)
  IF p_is_legacy THEN
    SELECT COUNT(*) INTO v_legacy_interaction_count
    FROM leads_leadinteractions
    WHERE lead_id = v_client_id::BIGINT;
    
    IF v_legacy_interaction_count > 0 THEN
      v_has_any_interaction := TRUE;
      -- Check for outbound (OR with existing value)
      SELECT COUNT(*) > 0 INTO v_temp_has_outbound
      FROM leads_leadinteractions
      WHERE lead_id = v_client_id::BIGINT AND direction = 'o';
      v_has_outbound := v_has_outbound OR COALESCE(v_temp_has_outbound, FALSE);
      -- Check for inbound (OR with existing value)
      SELECT COUNT(*) > 0 INTO v_temp_has_inbound
      FROM leads_leadinteractions
      WHERE lead_id = v_client_id::BIGINT AND direction = 'i';
      v_has_inbound := v_has_inbound OR COALESCE(v_temp_has_inbound, FALSE);
      -- Check for calls over 2 minutes (OR with existing value)
      SELECT COUNT(*) > 0 INTO v_temp_has_call_over_2min
      FROM leads_leadinteractions
      WHERE lead_id = v_client_id::BIGINT 
        AND kind = 'c' 
        AND minutes > 2;
      v_has_call_over_2min := v_has_call_over_2min OR COALESCE(v_temp_has_call_over_2min, FALSE);
    END IF;
  END IF;

  -- Check manual_interactions from leads table (new leads only)
  IF NOT p_is_legacy THEN
    SELECT 
      CASE WHEN manual_interactions IS NOT NULL AND jsonb_array_length(manual_interactions) > 0 
        THEN jsonb_array_length(manual_interactions) 
        ELSE 0 
      END
    INTO v_manual_interaction_count
    FROM leads
    WHERE id = v_client_id::UUID;
    
    IF v_manual_interaction_count > 0 THEN
      v_has_any_interaction := TRUE;
      -- Check for outbound and inbound in manual_interactions (OR with existing values)
      SELECT 
        COUNT(*) > 0 INTO v_temp_has_outbound
      FROM leads,
        jsonb_array_elements(manual_interactions) AS interaction
      WHERE id = v_client_id::UUID
        AND (interaction->>'direction') = 'out';
      v_has_outbound := v_has_outbound OR COALESCE(v_temp_has_outbound, FALSE);
      
      SELECT 
        COUNT(*) > 0 INTO v_temp_has_inbound
      FROM leads,
        jsonb_array_elements(manual_interactions) AS interaction
      WHERE id = v_client_id::UUID
        AND (interaction->>'direction') = 'in';
      v_has_inbound := v_has_inbound OR COALESCE(v_temp_has_inbound, FALSE);
      
      -- Check for calls over 2 minutes in manual_interactions (OR with existing value)
      SELECT 
        COUNT(*) > 0 INTO v_temp_has_call_over_2min
      FROM leads,
        jsonb_array_elements(manual_interactions) AS interaction
      WHERE id = v_client_id::UUID
        AND (interaction->>'kind') IN ('call', 'phone')
        AND (interaction->>'length') IS NOT NULL
        AND (
          -- Parse duration from various formats
          CASE 
            WHEN (interaction->>'length') ~ '^[0-9]+$' THEN (interaction->>'length')::NUMERIC
            WHEN (interaction->>'length') ~ '^([0-9]+)\s*(?:min|m)' THEN 
              (regexp_match(interaction->>'length', '^([0-9]+)\s*(?:min|m)'))[1]::NUMERIC
            WHEN (interaction->>'length') ~ '^([0-9]+):([0-9]+)$' THEN 
              (regexp_match(interaction->>'length', '^([0-9]+):([0-9]+)$'))[1]::NUMERIC + 
              (regexp_match(interaction->>'length', '^([0-9]+):([0-9]+)$'))[2]::NUMERIC / 60.0
            WHEN (interaction->>'length') ~ '^([0-9]+)\s*s' THEN 
              (regexp_match(interaction->>'length', '^([0-9]+)\s*s'))[1]::NUMERIC / 60.0
            ELSE 0
          END
        ) > 2;
      v_has_call_over_2min := v_has_call_over_2min OR COALESCE(v_temp_has_call_over_2min, FALSE);
    END IF;
  END IF;

  -- Log summary of detected interactions
  RAISE NOTICE 'Interaction summary for lead % (legacy: %): outbound=%, inbound=%, call_over_2min=%, any_interaction=%', 
    p_lead_id, p_is_legacy, v_has_outbound, v_has_inbound, v_has_call_over_2min, v_has_any_interaction;

  -- Evaluate stage transitions
  -- Stage 15 (Communication Started) - higher priority
  -- Only if current stage is 0, 10, or 11
  IF (v_current_stage = 0 OR v_current_stage = 10 OR v_current_stage = 11) THEN
    RAISE NOTICE 'Checking stage 15 conditions: outbound=%, inbound=%, call_over_2min=%', 
      v_has_outbound, v_has_inbound, v_has_call_over_2min;
    -- Must have both outbound AND inbound interactions
    -- AND at least one call over 2 minutes
    IF v_has_outbound AND v_has_inbound AND v_has_call_over_2min THEN
      v_new_stage := 15;
      RAISE NOTICE 'Transitioning to stage 15 (Communication Started): lead=%, legacy=%, outbound=%, inbound=%, call_over_2min=%', 
        p_lead_id, p_is_legacy, v_has_outbound, v_has_inbound, v_has_call_over_2min;
      BEGIN
        IF p_is_legacy THEN
          EXECUTE format('UPDATE %I SET stage = $1 WHERE %I = $2', v_table_name, v_id_field)
            USING v_new_stage, v_client_id::BIGINT;
        ELSE
          EXECUTE format('UPDATE %I SET stage = $1 WHERE %I = $2', v_table_name, v_id_field)
            USING v_new_stage, v_client_id::UUID;
        END IF;
        RAISE NOTICE 'Successfully updated stage to 15 for lead %', p_lead_id;
        RETURN v_new_stage;
      EXCEPTION WHEN OTHERS THEN
        -- If update fails, return current stage
        RAISE WARNING 'Failed to update stage to 15: %', SQLERRM;
        RETURN v_current_stage;
      END;
    ELSE
      RAISE NOTICE 'Cannot transition to stage 15: missing conditions (outbound=%, inbound=%, call_over_2min=%) for lead %', 
        v_has_outbound, v_has_inbound, v_has_call_over_2min, p_lead_id;
    END IF;
  ELSE
    RAISE NOTICE 'Cannot transition to stage 15: current stage is % (must be 0, 10, or 11) for lead %', v_current_stage, p_lead_id;
  END IF;

  -- Stage 11 (Precommunication)
  -- Only if current stage is 0 or 10
  IF (v_current_stage = 0 OR v_current_stage = 10) THEN
    RAISE NOTICE 'Checking stage 11 conditions: has_any_interaction=%, outbound=%, inbound=%', 
      v_has_any_interaction, v_has_outbound, v_has_inbound;
    IF v_has_any_interaction THEN
      -- Must have only one direction (outbound OR inbound, not both)
      IF (v_has_outbound AND NOT v_has_inbound) OR (NOT v_has_outbound AND v_has_inbound) THEN
        RAISE NOTICE 'One-direction communication detected: outbound=%, inbound=%', v_has_outbound, v_has_inbound;
        -- Must not have calls over 2 minutes
        IF NOT v_has_call_over_2min THEN
          v_new_stage := 11;
          RAISE NOTICE 'Transitioning to stage 11 (Precommunication): lead=%, legacy=%, outbound=%, inbound=%, call_over_2min=%', 
            p_lead_id, p_is_legacy, v_has_outbound, v_has_inbound, v_has_call_over_2min;
          BEGIN
            IF p_is_legacy THEN
              EXECUTE format('UPDATE %I SET stage = $1 WHERE %I = $2', v_table_name, v_id_field)
                USING v_new_stage, v_client_id::BIGINT;
            ELSE
              EXECUTE format('UPDATE %I SET stage = $1 WHERE %I = $2', v_table_name, v_id_field)
                USING v_new_stage, v_client_id::UUID;
            END IF;
            RAISE NOTICE 'Successfully updated stage to 11 for lead %', p_lead_id;
            RETURN v_new_stage;
          EXCEPTION WHEN OTHERS THEN
            -- If update fails, return current stage
            RAISE WARNING 'Failed to update stage: %', SQLERRM;
            RETURN v_current_stage;
          END;
        ELSE
          RAISE NOTICE 'Cannot transition to stage 11: call over 2 minutes exists (lead=%, legacy=%)', p_lead_id, p_is_legacy;
        END IF;
      END IF;
    ELSE
      RAISE NOTICE 'Cannot transition to stage 11: no interactions found (lead=%, legacy=%)', p_lead_id, p_is_legacy;
    END IF;
  ELSE
    RAISE NOTICE 'Cannot transition to stage 11: current stage is % (must be 0 or 10) for lead %', v_current_stage, p_lead_id;
  END IF;

  -- No stage change needed
  RAISE NOTICE 'No stage change needed: current_stage=% for lead %', v_current_stage, p_lead_id;
  RETURN v_current_stage;
END;
$$ LANGUAGE plpgsql;

