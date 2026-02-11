-- Fix permission issues with stage evaluation triggers
-- This script recreates the trigger functions with SECURITY DEFINER
-- so they can create and insert into the pending_stage_evaluations temp table
--
-- IMPORTANT: Run this AFTER running stage_transition_function.sql and stage_transition_triggers.sql
-- This will update the existing functions with proper permissions

-- Fix: Recreate ensure_pending_evaluations_table with SECURITY DEFINER
CREATE OR REPLACE FUNCTION ensure_pending_evaluations_table()
RETURNS void 
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  CREATE TEMP TABLE IF NOT EXISTS pending_stage_evaluations (
    lead_key TEXT PRIMARY KEY,
    lead_id TEXT NOT NULL,
    is_legacy BOOLEAN NOT NULL
  ) ON COMMIT DELETE ROWS;
END;
$$ LANGUAGE plpgsql;

-- Fix: Recreate trigger_stage_evaluation_on_email with SECURITY DEFINER
CREATE OR REPLACE FUNCTION trigger_stage_evaluation_on_email()
RETURNS TRIGGER 
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Ensure temp table exists
  PERFORM ensure_pending_evaluations_table();

  -- Determine if this is a legacy lead or new lead
  IF NEW.legacy_id IS NOT NULL THEN
    -- Insert or ignore (to avoid duplicates)
    INSERT INTO pending_stage_evaluations (lead_key, lead_id, is_legacy)
    VALUES ('legacy_' || NEW.legacy_id::TEXT, NEW.legacy_id::TEXT, TRUE)
    ON CONFLICT (lead_key) DO NOTHING;
  ELSIF NEW.client_id IS NOT NULL THEN
    -- Insert or ignore (to avoid duplicates)
    INSERT INTO pending_stage_evaluations (lead_key, lead_id, is_legacy)
    VALUES ('new_' || NEW.client_id::TEXT, NEW.client_id::TEXT, FALSE)
    ON CONFLICT (lead_key) DO NOTHING;
  END IF;
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Fix: Recreate process_pending_stage_evaluations with SECURITY DEFINER
CREATE OR REPLACE FUNCTION process_pending_stage_evaluations()
RETURNS void 
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_eval RECORD;
BEGIN
  -- Ensure temp table exists
  PERFORM ensure_pending_evaluations_table();
  
  -- Process all pending evaluations (deduplicated by lead_key)
  FOR v_eval IN SELECT DISTINCT lead_id, is_legacy FROM pending_stage_evaluations
  LOOP
    RAISE NOTICE 'Processing stage evaluation: lead_id=%, is_legacy=%', v_eval.lead_id, v_eval.is_legacy;
    PERFORM evaluate_and_update_stage(v_eval.lead_id, v_eval.is_legacy);
  END LOOP;
  
  -- Clear the temp table for next transaction
  TRUNCATE TABLE pending_stage_evaluations;
END;
$$ LANGUAGE plpgsql;

-- Fix: Recreate trigger_process_evaluations_statement with SECURITY DEFINER
CREATE OR REPLACE FUNCTION trigger_process_evaluations_statement()
RETURNS TRIGGER 
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Process all evaluations collected during this statement
  PERFORM process_pending_stage_evaluations();
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

-- Fix: Recreate trigger_stage_evaluation_on_whatsapp with SECURITY DEFINER
CREATE OR REPLACE FUNCTION trigger_stage_evaluation_on_whatsapp()
RETURNS TRIGGER 
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Ensure temp table exists
  PERFORM ensure_pending_evaluations_table();

  -- Determine if this is a legacy lead or new lead
  IF NEW.legacy_id IS NOT NULL THEN
    INSERT INTO pending_stage_evaluations (lead_key, lead_id, is_legacy)
    VALUES ('legacy_' || NEW.legacy_id::TEXT, NEW.legacy_id::TEXT, TRUE)
    ON CONFLICT (lead_key) DO NOTHING;
  ELSIF NEW.lead_id IS NOT NULL THEN
    INSERT INTO pending_stage_evaluations (lead_key, lead_id, is_legacy)
    VALUES ('new_' || NEW.lead_id::TEXT, NEW.lead_id::TEXT, FALSE)
    ON CONFLICT (lead_key) DO NOTHING;
  END IF;
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Fix: Recreate trigger_stage_evaluation_on_call with SECURITY DEFINER
CREATE OR REPLACE FUNCTION trigger_stage_evaluation_on_call()
RETURNS TRIGGER 
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_lead_id TEXT;
  v_is_legacy BOOLEAN;
BEGIN
  -- call_logs.lead_id can be either BIGINT (legacy) or TEXT/UUID (new)
  -- We need to determine which by checking if it's numeric
  IF NEW.lead_id IS NOT NULL THEN
    -- Try to determine if it's legacy (numeric) or new (UUID)
    -- If lead_id is numeric, it's legacy; if it contains hyphens, it's UUID
    IF NEW.lead_id::TEXT ~ '^[0-9]+$' THEN
      -- It's a numeric ID, so it's legacy
      v_lead_id := NEW.lead_id::TEXT;
      v_is_legacy := TRUE;
    ELSE
      -- It's likely a UUID or text ID for new leads
      v_lead_id := NEW.lead_id::TEXT;
      v_is_legacy := FALSE;
    END IF;
  ELSE
    -- No lead associated, skip evaluation
    RETURN NEW;
  END IF;

  -- Evaluate and update stage
  -- Note: Trigger fires AFTER insert/update, so the row is already visible
  RAISE NOTICE 'Call trigger fired: lead_id=%, is_legacy=%, direction=%', v_lead_id, v_is_legacy, NEW.direction;
  PERFORM evaluate_and_update_stage(v_lead_id, v_is_legacy);
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Fix: Recreate trigger_stage_evaluation_on_legacy_interaction with SECURITY DEFINER
CREATE OR REPLACE FUNCTION trigger_stage_evaluation_on_legacy_interaction()
RETURNS TRIGGER 
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_lead_id TEXT;
BEGIN
  IF NEW.lead_id IS NOT NULL THEN
    v_lead_id := NEW.lead_id::TEXT;
    
    -- Evaluate and update stage (always legacy for this table)
    -- Note: Trigger fires AFTER insert/update, so the row is already visible
    PERFORM evaluate_and_update_stage(v_lead_id, TRUE);
  END IF;
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Fix: Recreate trigger_stage_evaluation_on_manual_interaction with SECURITY DEFINER
CREATE OR REPLACE FUNCTION trigger_stage_evaluation_on_manual_interaction()
RETURNS TRIGGER 
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_lead_id TEXT;
BEGIN
  -- Only evaluate if manual_interactions actually changed
  IF (TG_OP = 'UPDATE' AND OLD.manual_interactions IS NOT DISTINCT FROM NEW.manual_interactions) THEN
    RETURN NEW;
  END IF;

  -- Only evaluate if manual_interactions is not null and has content
  IF NEW.manual_interactions IS NULL OR jsonb_array_length(NEW.manual_interactions) = 0 THEN
    RETURN NEW;
  END IF;

  v_lead_id := NEW.id::TEXT;
  
  -- Evaluate and update stage (always new lead for this table)
  -- Note: Trigger fires AFTER update, so the row is already visible
  PERFORM evaluate_and_update_stage(v_lead_id, FALSE);
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Verify the functions were updated correctly
DO $$
BEGIN
  RAISE NOTICE '✅ All trigger functions have been updated with SECURITY DEFINER';
  RAISE NOTICE '✅ Functions will now run with elevated privileges';
  RAISE NOTICE '✅ This should fix the "permission denied for table pending_stage_evaluations" error';
END $$;
