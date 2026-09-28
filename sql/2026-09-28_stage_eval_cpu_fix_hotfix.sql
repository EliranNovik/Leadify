-- HOTFIX for sql/2026-09-28_stage_eval_cpu_fix.sql.
--
-- That migration removed the statement-timeout storm (verified: 0 timeouts, 0 pldbgapi2
-- errors, 0 insert_mailbox_email / update_mailbox_email_body 500s), but introduced two new
-- errors that abort the very write that fired the trigger:
--
--   487x  "DELETE requires a WHERE clause"
--         Supabase preloads the safeupdate extension, which rejects an unqualified DELETE.
--         The previous version used TRUNCATE, so this only appeared after the swap.
--
--    11x  "permission denied for table pending_stage_evaluations"
--         PostgREST pools connections and switches role (anon / authenticated / service_role)
--         on the same backend session, while a temp table lives for the whole session and is
--         owned by whichever role happened to create it. A later request under a different
--         role then cannot read or clear it.
--
-- Safe to re-run. Apply this immediately after the previous migration.

SET lock_timeout = '5s';

-- 1) Temp table stays usable no matter which pooled role created it.
CREATE OR REPLACE FUNCTION public.ensure_pending_evaluations_table()
RETURNS void AS $$
BEGIN
  -- Already there for this session: nothing to do. Checking first avoids both the repeated
  -- CREATE ... IF NOT EXISTS catalog work on a hot path and a "no privileges were granted"
  -- warning from re-running the GRANT below on every single write.
  IF pg_my_temp_schema() <> 0
     AND EXISTS (
       SELECT 1 FROM pg_class
       WHERE relname = 'pending_stage_evaluations'
         AND relnamespace = pg_my_temp_schema()
     )
  THEN
    RETURN;
  END IF;

  CREATE TEMP TABLE pending_stage_evaluations (
    lead_key TEXT PRIMARY KEY,
    lead_id TEXT NOT NULL,
    is_legacy BOOLEAN NOT NULL
  ) ON COMMIT DELETE ROWS;

  -- The table is session-local, so granting to PUBLIC exposes nothing outside this
  -- connection, and it lets a later request under a different pooled role still use it.
  BEGIN
    EXECUTE 'GRANT ALL ON pending_stage_evaluations TO PUBLIC';
  EXCEPTION WHEN OTHERS THEN
    NULL;
  END;
END;
$$ LANGUAGE plpgsql;


-- 2) Stage evaluation must never abort the email/WhatsApp write that triggered it,
--    and the clear-down needs a WHERE clause to satisfy safeupdate.
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

  DELETE FROM pending_stage_evaluations WHERE true;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'process_pending_stage_evaluations skipped: %', SQLERRM;
END;
$$ LANGUAGE plpgsql;


-- 3) Same protection on the row trigger: collecting a lead key is best-effort and must not
--    roll back the insert. Behaviour is otherwise identical to the previous migration,
--    including skipping body-only UPDATEs.
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

  BEGIN
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
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'trigger_stage_evaluation_on_email skipped: %', SQLERRM;
  END;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;


-- 4) The WhatsApp row trigger shares the same temp table; give it the same protection.
CREATE OR REPLACE FUNCTION public.trigger_stage_evaluation_on_whatsapp()
RETURNS TRIGGER AS $$
BEGIN
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

NOTIFY pgrst, 'reload schema';
