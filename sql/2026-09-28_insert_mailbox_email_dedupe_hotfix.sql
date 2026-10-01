-- STOP mailbox sync from re-inserting every message on every cycle.
--
-- Measured (sql/2026-09-28_mailbox_sync_cpu_diagnose.sql):
--   * newest 200,000 emails rows hold only 2,680 distinct message_ids  (~75 rows per message)
--   * worst message in the recent window: 90 rows, 1 distinct (client_id, legacy_id, contact_id)
--   * emails is 208 GB total, of which 189 GB is TOAST
--   * autovacuum last completed 2026-09-22 with 816k dead tuples
--
-- Root cause: insert_mailbox_email dedupes ONLY through
--   EXCEPTION WHEN unique_violation -> SELECT the existing id
-- and the backend deliberately skips a pre-SELECT
-- (graphMailboxSyncService.js:2212 "Do not SELECT emails by message_id first").
-- The only unique index covering message_id is
--   emails_message_id_client_legacy_contact_unique (message_id, client_id, legacy_id, contact_id)
-- and a btree unique index treats NULL as distinct from NULL. Mailbox sync always leaves at
-- least one of those three NULL — a lead is either new (client_id) or legacy (legacy_id), never
-- both — so two identical rows never collide and the exception handler never runs. Confirmed:
-- all 90 duplicate rows carried client_id + contact_id set and legacy_id NULL.
--
-- Fix: give the function an explicit NULL-safe pre-check. This is the cheapest possible place
-- to fix it because:
--   * CREATE OR REPLACE FUNCTION takes no lock on public.emails, so it is safe while sync runs
--     (unlike CREATE TRIGGER or CREATE UNIQUE INDEX, which take an AccessExclusiveLock and
--     deadlock live sync — see sql/2026-08-16_emails_sync_lookup_and_drop_mv_trigger.sql).
--   * every writer calls this one RPC, so the not-yet-deployed backend is covered too.
--
-- Grain is unchanged on purpose: still one row per (message_id, client_id, legacy_id, contact_id),
-- exactly what emails_message_id_client_legacy_contact_unique was meant to enforce. This is a
-- bug fix, not the "one row per message + email_contacts junction" migration that
-- sql/2026-08-16_emails_one_row_per_message_contacts.sql describes as the end state.
--
-- Does NOT delete existing duplicates — that is a separate batched job, and it has to come
-- after this so the cleanup is not racing new inserts.
--
-- Safe to re-run.

SET lock_timeout = '5s';

CREATE OR REPLACE FUNCTION public.insert_mailbox_email(p_row jsonb)
RETURNS bigint
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
SET row_security = off
SET statement_timeout = '60s'
AS $$
DECLARE
  v_id bigint;
  v_message_id text;
  v_client_id uuid;
  v_legacy_id bigint;
  v_contact_id bigint;
BEGIN
  -- Extract the dedupe key once, with the same casts the INSERT below uses, so the pre-check
  -- and the stored row can never disagree about what counts as the same message.
  v_message_id := NULLIF(p_row->>'message_id', '');
  v_client_id  := NULLIF(p_row->>'client_id', '')::uuid;
  v_legacy_id  := NULLIF(p_row->>'legacy_id', '')::bigint;
  v_contact_id := NULLIF(p_row->>'contact_id', '')::bigint;

  -- IS NOT DISTINCT FROM is the whole point: it makes NULL = NULL, which the unique index
  -- does not. The message_id equality is what drives the index scan (idx_emails_message_id);
  -- the three NULL-safe comparisons then filter the handful of rows it returns. Only id is
  -- selected so this never detoasts body_html.
  IF v_message_id IS NOT NULL THEN
    SELECT e.id INTO v_id
    FROM public.emails e
    WHERE e.message_id = v_message_id
      AND e.client_id  IS NOT DISTINCT FROM v_client_id
      AND e.legacy_id  IS NOT DISTINCT FROM v_legacy_id
      AND e.contact_id IS NOT DISTINCT FROM v_contact_id
    ORDER BY e.id
    LIMIT 1;

    IF v_id IS NOT NULL THEN
      RETURN v_id;
    END IF;
  END IF;

  BEGIN
    PERFORM set_config('session_replication_role', 'replica', true);
  EXCEPTION
    WHEN OTHERS THEN
      NULL;
  END;

  INSERT INTO public.emails (
    message_id,
    user_id,
    sender_name,
    sender_email,
    recipient_list,
    subject,
    body_html,
    body_preview,
    sent_at,
    direction,
    attachments,
    client_id,
    legacy_id,
    contact_id,
    thread_id,
    body_cached
  ) VALUES (
    v_message_id,
    -- emails.user_id → auth.users(id). Mailbox tokens carry public.users.id (23503).
    NULL,
    p_row->>'sender_name',
    p_row->>'sender_email',
    p_row->>'recipient_list',
    COALESCE(p_row->>'subject', '(no subject)'),
    COALESCE(p_row->>'body_html', ''),
    p_row->>'body_preview',
    COALESCE((p_row->>'sent_at')::timestamptz, now()),
    NULLIF(p_row->>'direction', ''),
    CASE WHEN p_row ? 'attachments' THEN p_row->'attachments' ELSE NULL END,
    v_client_id,
    v_legacy_id,
    v_contact_id,
    p_row->>'thread_id',
    COALESCE((p_row->>'body_cached')::boolean, false)
  )
  RETURNING emails.id INTO v_id;

  RETURN v_id;
EXCEPTION
  WHEN unique_violation THEN
    -- Backstop for a genuine race between the pre-check and the insert. Match on the full key
    -- first: the old code matched on message_id alone, which could hand back a row belonging to
    -- a different contact.
    SELECT e.id INTO v_id
    FROM public.emails e
    WHERE e.message_id = v_message_id
      AND e.client_id  IS NOT DISTINCT FROM v_client_id
      AND e.legacy_id  IS NOT DISTINCT FROM v_legacy_id
      AND e.contact_id IS NOT DISTINCT FROM v_contact_id
    ORDER BY e.id
    LIMIT 1;

    IF v_id IS NULL THEN
      SELECT e.id INTO v_id
      FROM public.emails e
      WHERE e.message_id = v_message_id
      ORDER BY e.id
      LIMIT 1;
    END IF;

    RETURN v_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.insert_mailbox_email(jsonb)
  TO anon, authenticated, service_role;

NOTIFY pgrst, 'reload schema';

-- Verify: run this a few minutes after applying. distinct_message_ids should now track
-- sampled_rows closely for newly written rows (older duplicates stay until the cleanup job).
--
-- WITH recent AS (
--   SELECT message_id FROM public.emails ORDER BY id DESC LIMIT 20000
-- )
-- SELECT count(*) AS sampled_rows, count(DISTINCT message_id) AS distinct_message_ids
-- FROM recent WHERE message_id IS NOT NULL;
