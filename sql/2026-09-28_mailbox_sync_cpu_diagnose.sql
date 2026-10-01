-- Follow-up on the pg_stat_statements snapshot that showed insert_mailbox_email (5.55M calls,
-- 964 ms mean) and update_mailbox_email_body (4.75M calls, 1,126 ms mean) as the top two
-- cumulative consumers.
--
-- Two things that snapshot cannot tell us, in priority order:
--
-- 1) IS THERE A UNIQUE INDEX ON emails(message_id)?
--    insert_mailbox_email (sql/2026-08-16_emails_sync_lookup_and_drop_mv_trigger.sql) dedupes
--    entirely through "EXCEPTION WHEN unique_violation -> SELECT the existing id", and the
--    backend deliberately skips a pre-SELECT (graphMailboxSyncService.js:2212 "Do not SELECT
--    emails by message_id first"). That contract only holds if a UNIQUE index exists.
--    But sql/2026-08-16_emails_one_row_per_message_contacts.sql says "Do not CREATE UNIQUE
--    INDEX on emails(message_id) until duplicates are gone", and the only message_id index in
--    the repo is the NON-unique idx_emails_message_id. If the unique index was never created,
--    the exception never fires and every re-seen Graph message INSERTS A NEW DUPLICATE ROW.
--    That would explain the insert volume, the row count, and disk at 69% far better than any
--    missing lookup index.
--
-- 2) WHAT IS HOT *NOW*? pg_stat_statements is cumulative since the last reset, so those totals
--    mostly predate today's sql/2026-09-28_stage_eval_cpu_fix.sql. That migration is the
--    documented reason update_mailbox_email_body cost ~918 ms on a lead-linked row (the stage
--    trigger), so its mean should already be far lower. Section 2 measures a live delta.
--
-- Section 1 is read-only and cheap. Run it on its own.

-- ---------------------------------------------------------------------------
-- Section 1 — index inventory, duplicate check, bloat. Single row of JSON.
-- ---------------------------------------------------------------------------
WITH idx AS (
  SELECT
    ci.relname                      AS name,
    ix.indisunique                  AS is_unique,
    s.idx_scan                      AS scans,
    pg_relation_size(ix.indexrelid) AS bytes,
    pg_get_indexdef(ix.indexrelid)  AS def
  FROM pg_index ix
  JOIN pg_class ci ON ci.oid = ix.indexrelid
  LEFT JOIN pg_stat_user_indexes s ON s.indexrelid = ix.indexrelid
  WHERE ix.indrelid = 'public.emails'::regclass
),
-- Newest rows only: a backward scan on the primary key, so this stays cheap on a 12M-row
-- table. Any gap between with_message_id and distinct_message_ids means the sync is STILL
-- creating duplicates right now, which is what matters — historical dupes are already known.
recent AS (
  SELECT message_id
  FROM public.emails
  ORDER BY id DESC
  LIMIT 200000
),
dupes AS (
  SELECT
    count(*)                   AS sampled_rows,
    count(message_id)          AS with_message_id,
    count(DISTINCT message_id) AS distinct_message_ids
  FROM recent
),
tbl AS (
  SELECT n_live_tup, n_dead_tup, last_autovacuum, last_autoanalyze
  FROM pg_stat_user_tables
  WHERE relid = 'public.emails'::regclass
)
SELECT jsonb_pretty(jsonb_build_object(
  -- Empty array here is the finding: dedup is not enforced.
  'unique_index_on_message_id', (
    SELECT COALESCE(jsonb_agg(name), '[]'::jsonb)
    FROM idx
    WHERE is_unique AND def ILIKE '%(message_id)%'
  ),
  'recent_200k', (SELECT to_jsonb(d) FROM dupes d),
  'table_stats', (SELECT to_jsonb(t) FROM tbl t),
  'sizes', jsonb_build_object(
    'heap',    pg_size_pretty(pg_relation_size('public.emails')),
    'toast',   pg_size_pretty(COALESCE((
                 SELECT pg_total_relation_size(NULLIF(reltoastrelid, 0))
                 FROM pg_class WHERE oid = 'public.emails'::regclass
               ), 0)),
    'indexes', pg_size_pretty(pg_indexes_size('public.emails')),
    'total',   pg_size_pretty(pg_total_relation_size('public.emails'))
  ),
  -- Ordered by scans so never-used indexes surface first: every one of them is pure write
  -- overhead on the insert path we are trying to make cheaper.
  'emails_indexes', (
    SELECT jsonb_agg(jsonb_build_object(
      'name', name, 'unique', is_unique, 'scans', scans,
      'size', pg_size_pretty(bytes), 'def', def
    ) ORDER BY scans NULLS FIRST)
    FROM idx
  )
)) AS mailbox_sync_diagnose;


-- ---------------------------------------------------------------------------
-- Section 3 — are the duplicates identical, or legitimate per-contact fan-out?
--
-- Section 1 returned 200,000 newest rows holding only 2,680 distinct message_ids (~75 rows per
-- message), and no unique index on message_id alone. The only unique index covering it is
--   emails_message_id_client_legacy_contact_unique (message_id, client_id, legacy_id, contact_id)
-- and Postgres treats NULLs as distinct in a unique index, so any row with a NULL in
-- client_id / legacy_id / contact_id can never raise unique_violation. Mailbox sync always
-- leaves at least one of those NULL (a lead is either new -> client_id or legacy -> legacy_id),
-- which would make that index vacuous for the insert path and explain the 75x.
--
-- This distinguishes the two possibilities for the worst message in the recent window:
--   row_count >> distinct_key_combos  -> identical duplicates, the index never fires.
--   row_count == distinct_key_combos  -> real fan-out, one row per contact, index is working.
--
-- Deliberately never selects body_html: touching it would detoast every sampled row.
-- ---------------------------------------------------------------------------
WITH recent AS (
  SELECT id, message_id, client_id, legacy_id, contact_id
  FROM public.emails
  ORDER BY id DESC
  LIMIT 50000
),
worst AS (
  SELECT message_id
  FROM recent
  WHERE message_id IS NOT NULL
  GROUP BY message_id
  ORDER BY count(*) DESC
  LIMIT 1
),
hits AS (
  SELECT r.* FROM recent r JOIN worst w ON w.message_id = r.message_id
)
SELECT jsonb_pretty(jsonb_build_object(
  'row_count',           (SELECT count(*) FROM hits),
  'distinct_key_combos', (SELECT count(*) FROM (
                            SELECT DISTINCT client_id, legacy_id, contact_id FROM hits
                          ) s),
  'nulls_in_key', (SELECT to_jsonb(x) FROM (
    SELECT count(*) FILTER (WHERE client_id  IS NULL) AS client_id_null,
           count(*) FILTER (WHERE legacy_id  IS NULL) AS legacy_id_null,
           count(*) FILTER (WHERE contact_id IS NULL) AS contact_id_null
    FROM hits
  ) x),
  'sample_rows', (SELECT jsonb_agg(to_jsonb(s) ORDER BY s.id DESC) FROM (
    SELECT id, client_id, legacy_id, contact_id FROM hits ORDER BY id DESC LIMIT 10
  ) s)
)) AS duplicate_shape;


-- ---------------------------------------------------------------------------
-- Section 2 — what is actually hot now (live delta, not since-reset totals).
-- Run 2A, leave the system under normal traffic for ~5 minutes, then run 2B.
-- Avoids pg_stat_statements_reset() so no history is destroyed.
-- ---------------------------------------------------------------------------

-- 2A) Baseline.
-- DROP TABLE IF EXISTS public.pgss_baseline;
-- CREATE TABLE public.pgss_baseline AS
-- SELECT userid, dbid, queryid, calls, total_exec_time, rows,
--        shared_blks_hit, shared_blks_read, shared_blks_dirtied
-- FROM pg_stat_statements;

-- 2B) Delta over the interval.
-- SELECT
--   s.calls - b.calls AS calls,
--   round((s.total_exec_time - b.total_exec_time)::numeric) AS total_ms,
--   round(((s.total_exec_time - b.total_exec_time)
--          / NULLIF(s.calls - b.calls, 0))::numeric, 1) AS mean_ms,
--   (s.shared_blks_read - b.shared_blks_read) AS blks_read,
--   (s.shared_blks_dirtied - b.shared_blks_dirtied) AS blks_dirtied,
--   left(regexp_replace(s.query, '\s+', ' ', 'g'), 160) AS query
-- FROM pg_stat_statements s
-- JOIN public.pgss_baseline b
--   ON b.queryid = s.queryid AND b.userid = s.userid AND b.dbid = s.dbid
-- WHERE s.calls > b.calls
-- ORDER BY (s.total_exec_time - b.total_exec_time) DESC
-- LIMIT 25;

-- 2C) Cleanup.
-- DROP TABLE IF EXISTS public.pgss_baseline;
