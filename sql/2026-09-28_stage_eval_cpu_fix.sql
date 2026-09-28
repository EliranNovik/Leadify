-- Supabase CPU + 57014 statement-timeout fix for mailbox sync.
--
-- Measured before this migration (service-role RPC timings against production):
--   update_mailbox_email_body on a row with NO lead link  ->  105 ms avg (stage trigger skipped)
--   update_mailbox_email_body on a lead-linked row        ->  918 ms avg (stage trigger fires)
--   evaluate_and_update_stage direct call, legacy lead    -> 2000 ms avg, 4991 ms peak
--   evaluate_and_update_stage direct call, new lead       ->  719 ms avg
--   76% of lead-linked email writes target leads whose stage is not 0/10/11,
--   so the whole evaluation could never change anything.
--
-- Root cause: every INSERT *and* every UPDATE on public.emails runs
-- evaluate_and_update_stage, which executes ~15 COUNT(*) queries over emails (12.2M rows),
-- leads_leadinteractions (2.25M rows), call_logs (521K rows) and whatsapp_messages —
-- including casts on indexed columns that force sequential scans. Mailbox sync writes each
-- message twice (insert + body patch), so each synced email cost seconds of pure DB CPU.
--
-- This migration only uses CREATE OR REPLACE FUNCTION. It never runs DROP/CREATE TRIGGER,
-- which would take an AccessExclusiveLock on public.emails and deadlock live sync.
--
-- Safe to re-run.

SET lock_timeout = '5s';

-- 1) evaluate_and_update_stage: early exit + existence checks instead of COUNT(*),
--    and no casts on indexed columns.
--
--    Semantics are unchanged:
--      * The stage-15 branch only runs when current stage is 0, 10 or 11.
--      * The stage-11 branch only runs when current stage is 0 or 10.
--      * Every other path returns the current stage untouched.
--    So returning early for any other stage is behaviour-preserving.
--      * Each v_*_count variable was only ever compared with "> 0", so EXISTS is equivalent.
CREATE OR REPLACE FUNCTION public.evaluate_and_update_stage(
  p_lead_id TEXT,
  p_is_legacy BOOLEAN
) RETURNS INTEGER AS $$
DECLARE
  v_current_stage BIGINT;
  v_client_id TEXT;
  v_legacy_id BIGINT;
  v_uuid UUID;
  v_has_outbound BOOLEAN := FALSE;
  v_has_inbound BOOLEAN := FALSE;
  v_has_call_over_2min BOOLEAN := FALSE;
  v_has_any_interaction BOOLEAN := FALSE;
  v_new_stage INTEGER;
BEGIN
  v_client_id := p_lead_id;

  -- Resolve the id once; a bad id means there is nothing to evaluate.
  BEGIN
    IF p_is_legacy THEN
      v_legacy_id := v_client_id::BIGINT;
      SELECT stage INTO v_current_stage FROM public.leads_lead WHERE id = v_legacy_id;
    ELSE
      v_uuid := v_client_id::UUID;
      SELECT stage INTO v_current_stage FROM public.leads WHERE id = v_uuid;
    END IF;
  EXCEPTION WHEN OTHERS THEN
    RETURN 0;
  END;

  IF v_current_stage IS NULL THEN
    RETURN 0;
  END IF;

  -- Fast path: no transition is reachable from any other stage, so skip all interaction
  -- scanning. This removes ~76% of evaluations outright.
  IF v_current_stage NOT IN (0, 10, 11) THEN
    RETURN v_current_stage;
  END IF;

  -- ---------------------------------------------------------------- emails
  IF p_is_legacy THEN
    IF EXISTS (SELECT 1 FROM public.emails WHERE legacy_id = v_legacy_id) THEN
      v_has_any_interaction := TRUE;
      v_has_outbound := v_has_outbound OR EXISTS (
        SELECT 1 FROM public.emails WHERE legacy_id = v_legacy_id AND direction = 'outgoing'
      );
      v_has_inbound := v_has_inbound OR EXISTS (
        SELECT 1 FROM public.emails WHERE legacy_id = v_legacy_id AND direction = 'incoming'
      );
    END IF;
  ELSE
    IF EXISTS (SELECT 1 FROM public.emails WHERE client_id = v_uuid) THEN
      v_has_any_interaction := TRUE;
      v_has_outbound := v_has_outbound OR EXISTS (
        SELECT 1 FROM public.emails WHERE client_id = v_uuid AND direction = 'outgoing'
      );
      v_has_inbound := v_has_inbound OR EXISTS (
        SELECT 1 FROM public.emails WHERE client_id = v_uuid AND direction = 'incoming'
      );
    END IF;
  END IF;

  -- ------------------------------------------------------- whatsapp_messages
  IF p_is_legacy THEN
    IF EXISTS (SELECT 1 FROM public.whatsapp_messages WHERE legacy_id = v_legacy_id) THEN
      v_has_any_interaction := TRUE;
      v_has_outbound := v_has_outbound OR EXISTS (
        SELECT 1 FROM public.whatsapp_messages WHERE legacy_id = v_legacy_id AND direction = 'out'
      );
      v_has_inbound := v_has_inbound OR EXISTS (
        SELECT 1 FROM public.whatsapp_messages WHERE legacy_id = v_legacy_id AND direction = 'in'
      );
    END IF;
  ELSE
    IF EXISTS (SELECT 1 FROM public.whatsapp_messages WHERE lead_id = v_uuid) THEN
      v_has_any_interaction := TRUE;
      v_has_outbound := v_has_outbound OR EXISTS (
        SELECT 1 FROM public.whatsapp_messages WHERE lead_id = v_uuid AND direction = 'out'
      );
      v_has_inbound := v_has_inbound OR EXISTS (
        SELECT 1 FROM public.whatsapp_messages WHERE lead_id = v_uuid AND direction = 'in'
      );
    END IF;
  END IF;

  -- ------------------------------------------------------------- call_logs
  -- call_logs.lead_id is integer. The old code compared lead_id::BIGINT for legacy leads and
  -- lead_id::TEXT for new leads; both casts defeated the index and scanned all 521K rows on
  -- every email write. Comparing the column directly returns the same rows and uses the index.
  --
  -- The new-lead branch is dropped on purpose: it compared an integer rendered as text against
  -- a UUID, which can never match, so it always returned zero rows while still scanning the
  -- whole table. (call_logs.client_id is the real link for new leads, but wiring that up would
  -- change which leads transition, so it stays out of a performance fix.)
  IF p_is_legacy THEN
    IF EXISTS (SELECT 1 FROM public.call_logs WHERE lead_id = v_legacy_id) THEN
      v_has_any_interaction := TRUE;
      v_has_outbound := v_has_outbound OR EXISTS (
        SELECT 1 FROM public.call_logs
        WHERE lead_id = v_legacy_id
          AND (direction ILIKE '%outgoing%' OR direction = 'out')
      );
      v_has_inbound := v_has_inbound OR EXISTS (
        SELECT 1 FROM public.call_logs
        WHERE lead_id = v_legacy_id
          AND (direction ILIKE '%incoming%' OR direction = 'in')
      );
      v_has_call_over_2min := v_has_call_over_2min OR EXISTS (
        SELECT 1 FROM public.call_logs
        WHERE lead_id = v_legacy_id AND duration > 120
      );
    END IF;
  END IF;

  -- ------------------------------------------- leads_leadinteractions (legacy)
  IF p_is_legacy THEN
    IF EXISTS (SELECT 1 FROM public.leads_leadinteractions WHERE lead_id = v_legacy_id) THEN
      v_has_any_interaction := TRUE;
      v_has_outbound := v_has_outbound OR EXISTS (
        SELECT 1 FROM public.leads_leadinteractions WHERE lead_id = v_legacy_id AND direction = 'o'
      );
      v_has_inbound := v_has_inbound OR EXISTS (
        SELECT 1 FROM public.leads_leadinteractions WHERE lead_id = v_legacy_id AND direction = 'i'
      );
      v_has_call_over_2min := v_has_call_over_2min OR EXISTS (
        SELECT 1 FROM public.leads_leadinteractions
        WHERE lead_id = v_legacy_id AND kind = 'c' AND minutes > 2
      );
    END IF;
  END IF;

  -- ------------------------------- leads.manual_interactions (new leads only)
  IF NOT p_is_legacy THEN
    IF EXISTS (
      SELECT 1 FROM public.leads
      WHERE id = v_uuid
        AND manual_interactions IS NOT NULL
        AND jsonb_array_length(manual_interactions) > 0
    ) THEN
      v_has_any_interaction := TRUE;

      v_has_outbound := v_has_outbound OR EXISTS (
        SELECT 1
        FROM public.leads l, jsonb_array_elements(l.manual_interactions) AS interaction
        WHERE l.id = v_uuid AND (interaction->>'direction') = 'out'
      );
      v_has_inbound := v_has_inbound OR EXISTS (
        SELECT 1
        FROM public.leads l, jsonb_array_elements(l.manual_interactions) AS interaction
        WHERE l.id = v_uuid AND (interaction->>'direction') = 'in'
      );
      v_has_call_over_2min := v_has_call_over_2min OR EXISTS (
        SELECT 1
        FROM public.leads l, jsonb_array_elements(l.manual_interactions) AS interaction
        WHERE l.id = v_uuid
          AND (interaction->>'kind') IN ('call', 'phone')
          AND (interaction->>'length') IS NOT NULL
          AND (
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
          ) > 2
      );
    END IF;
  END IF;

  -- ------------------------------------------------------------ transitions
  IF (v_current_stage = 0 OR v_current_stage = 10 OR v_current_stage = 11) THEN
    IF v_has_outbound AND v_has_inbound AND v_has_call_over_2min THEN
      v_new_stage := 15;
      BEGIN
        IF p_is_legacy THEN
          UPDATE public.leads_lead SET stage = v_new_stage WHERE id = v_legacy_id;
        ELSE
          UPDATE public.leads SET stage = v_new_stage WHERE id = v_uuid;
        END IF;
        RETURN v_new_stage;
      EXCEPTION WHEN OTHERS THEN
        RAISE WARNING 'Failed to update stage to 15: %', SQLERRM;
        RETURN v_current_stage;
      END;
    END IF;
  END IF;

  IF (v_current_stage = 0 OR v_current_stage = 10) THEN
    IF v_has_any_interaction THEN
      IF (v_has_outbound AND NOT v_has_inbound) OR (NOT v_has_outbound AND v_has_inbound) THEN
        IF NOT v_has_call_over_2min THEN
          v_new_stage := 11;
          BEGIN
            IF p_is_legacy THEN
              UPDATE public.leads_lead SET stage = v_new_stage WHERE id = v_legacy_id;
            ELSE
              UPDATE public.leads SET stage = v_new_stage WHERE id = v_uuid;
            END IF;
            RETURN v_new_stage;
          EXCEPTION WHEN OTHERS THEN
            RAISE WARNING 'Failed to update stage: %', SQLERRM;
            RETURN v_current_stage;
          END;
        END IF;
      END IF;
    END IF;
  END IF;

  RETURN v_current_stage;
END;
$$ LANGUAGE plpgsql;


-- 2) Row trigger on public.emails: only collect when something stage-relevant changed.
--    Mailbox sync patches body_html/body_preview/body_cached/attachments after every insert;
--    none of those can affect a stage, so that second write no longer triggers evaluation.
CREATE OR REPLACE FUNCTION public.trigger_stage_evaluation_on_email()
RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'UPDATE'
     AND NEW.direction IS NOT DISTINCT FROM OLD.direction
     AND NEW.client_id IS NOT DISTINCT FROM OLD.client_id
     AND NEW.legacy_id IS NOT DISTINCT FROM OLD.legacy_id
  THEN
    RETURN NEW;
  END IF;

  PERFORM public.ensure_pending_evaluations_table();

  IF NEW.legacy_id IS NOT NULL THEN
    INSERT INTO pending_stage_evaluations (lead_key, lead_id, is_legacy)
    VALUES ('legacy_' || NEW.legacy_id::TEXT, NEW.legacy_id::TEXT, TRUE)
    ON CONFLICT (lead_key) DO NOTHING;
  ELSIF NEW.client_id IS NOT NULL THEN
    INSERT INTO pending_stage_evaluations (lead_key, lead_id, is_legacy)
    VALUES ('new_' || NEW.client_id::TEXT, NEW.client_id::TEXT, FALSE)
    ON CONFLICT (lead_key) DO NOTHING;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;


-- 3) Statement trigger body: do nothing when the row trigger collected nothing, instead of
--    creating and TRUNCATEing a temp table on every statement (catalog churn on a hot path).
CREATE OR REPLACE FUNCTION public.process_pending_stage_evaluations()
RETURNS void AS $$
DECLARE
  v_eval RECORD;
BEGIN
  IF pg_my_temp_schema() = 0
     OR NOT EXISTS (
       SELECT 1 FROM pg_class
       WHERE relname = 'pending_stage_evaluations'
         AND relnamespace = pg_my_temp_schema()
     )
  THEN
    RETURN;
  END IF;

  FOR v_eval IN SELECT DISTINCT lead_id, is_legacy FROM pending_stage_evaluations
  LOOP
    PERFORM public.evaluate_and_update_stage(v_eval.lead_id, v_eval.is_legacy);
  END LOOP;

  DELETE FROM pending_stage_evaluations;
END;
$$ LANGUAGE plpgsql;


-- Supporting indexes are intentionally NOT created here: CREATE INDEX needs a ShareLock and
-- would let a busy table roll this whole migration back. Run
-- sql/2026-09-28_stage_eval_supporting_indexes.sql separately if the report shows any are missing.

NOTIFY pgrst, 'reload schema';
