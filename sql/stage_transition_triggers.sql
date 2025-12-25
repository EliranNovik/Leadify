-- Triggers to automatically evaluate and update stage when interactions are saved
-- These triggers call the evaluate_and_update_stage function after inserts/updates
-- 
-- IMPORTANT: Run sql/stage_transition_function.sql FIRST before running this file

-- Create session-level temp table for batching evaluations (created once per session)
CREATE OR REPLACE FUNCTION ensure_pending_evaluations_table()
RETURNS void AS $$
BEGIN
  CREATE TEMP TABLE IF NOT EXISTS pending_stage_evaluations (
    lead_key TEXT PRIMARY KEY,
    lead_id TEXT NOT NULL,
    is_legacy BOOLEAN NOT NULL
  ) ON COMMIT DELETE ROWS;
END;
$$ LANGUAGE plpgsql;

-- Trigger function for emails table (row-level - collects leads to evaluate)
CREATE OR REPLACE FUNCTION trigger_stage_evaluation_on_email()
RETURNS TRIGGER AS $$
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

-- Function to process all pending stage evaluations
CREATE OR REPLACE FUNCTION process_pending_stage_evaluations()
RETURNS void AS $$
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

-- Statement-level trigger function to process all pending evaluations
CREATE OR REPLACE FUNCTION trigger_process_evaluations_statement()
RETURNS TRIGGER AS $$
BEGIN
  -- Process all evaluations collected during this statement
  PERFORM process_pending_stage_evaluations();
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

-- Drop existing triggers
DROP TRIGGER IF EXISTS email_stage_evaluation_trigger ON emails;
DROP TRIGGER IF EXISTS email_stage_evaluation_statement_trigger ON emails;

-- Row-level trigger: collects leads that need evaluation
CREATE TRIGGER email_stage_evaluation_trigger
  AFTER INSERT OR UPDATE ON emails
  FOR EACH ROW
  WHEN (NEW.client_id IS NOT NULL OR NEW.legacy_id IS NOT NULL)
  EXECUTE FUNCTION trigger_stage_evaluation_on_email();

-- Statement-level trigger: processes all collected leads once per INSERT/UPDATE statement
CREATE TRIGGER email_stage_evaluation_statement_trigger
  AFTER INSERT OR UPDATE ON emails
  FOR EACH STATEMENT
  EXECUTE FUNCTION trigger_process_evaluations_statement();

-- Trigger function for whatsapp_messages table (row-level - collects leads to evaluate)
CREATE OR REPLACE FUNCTION trigger_stage_evaluation_on_whatsapp()
RETURNS TRIGGER AS $$
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

-- Drop existing triggers
DROP TRIGGER IF EXISTS whatsapp_stage_evaluation_trigger ON whatsapp_messages;
DROP TRIGGER IF EXISTS whatsapp_stage_evaluation_statement_trigger ON whatsapp_messages;

-- Row-level trigger: collects leads that need evaluation
CREATE TRIGGER whatsapp_stage_evaluation_trigger
  AFTER INSERT OR UPDATE ON whatsapp_messages
  FOR EACH ROW
  WHEN (NEW.lead_id IS NOT NULL OR NEW.legacy_id IS NOT NULL)
  EXECUTE FUNCTION trigger_stage_evaluation_on_whatsapp();

-- Statement-level trigger: processes all collected leads once per INSERT/UPDATE statement
CREATE TRIGGER whatsapp_stage_evaluation_statement_trigger
  AFTER INSERT OR UPDATE ON whatsapp_messages
  FOR EACH STATEMENT
  EXECUTE FUNCTION trigger_process_evaluations_statement();

-- Trigger function for call_logs table
CREATE OR REPLACE FUNCTION trigger_stage_evaluation_on_call()
RETURNS TRIGGER AS $$
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
  RAISE NOTICE 'Email trigger fired: lead_id=%, is_legacy=%, direction=%', v_lead_id, v_is_legacy, NEW.direction;
  PERFORM evaluate_and_update_stage(v_lead_id, v_is_legacy);
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Trigger for call_logs table
DROP TRIGGER IF EXISTS call_logs_stage_evaluation_trigger ON call_logs;
CREATE TRIGGER call_logs_stage_evaluation_trigger
  AFTER INSERT OR UPDATE ON call_logs
  FOR EACH ROW
  WHEN (NEW.lead_id IS NOT NULL)
  EXECUTE FUNCTION trigger_stage_evaluation_on_call();

-- Trigger function for leads_leadinteractions table (legacy only)
CREATE OR REPLACE FUNCTION trigger_stage_evaluation_on_legacy_interaction()
RETURNS TRIGGER AS $$
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

-- Trigger for leads_leadinteractions table
DROP TRIGGER IF EXISTS legacy_interaction_stage_evaluation_trigger ON leads_leadinteractions;
CREATE TRIGGER legacy_interaction_stage_evaluation_trigger
  AFTER INSERT OR UPDATE ON leads_leadinteractions
  FOR EACH ROW
  WHEN (NEW.lead_id IS NOT NULL)
  EXECUTE FUNCTION trigger_stage_evaluation_on_legacy_interaction();

-- Trigger function for leads.manual_interactions updates (new leads only)
CREATE OR REPLACE FUNCTION trigger_stage_evaluation_on_manual_interaction()
RETURNS TRIGGER AS $$
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

-- Trigger for leads.manual_interactions updates
DROP TRIGGER IF EXISTS manual_interaction_stage_evaluation_trigger ON leads;
CREATE TRIGGER manual_interaction_stage_evaluation_trigger
  AFTER UPDATE OF manual_interactions ON leads
  FOR EACH ROW
  WHEN (NEW.manual_interactions IS NOT NULL AND jsonb_array_length(NEW.manual_interactions) > 0)
  EXECUTE FUNCTION trigger_stage_evaluation_on_manual_interaction();

