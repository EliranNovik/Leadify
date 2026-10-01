-- DRY RUN ONLY. Deletes nothing. Sizes the emails cleanup and, more importantly, measures what
-- a naive DELETE would silently break.
--
-- Apply sql/2026-09-28_insert_mailbox_email_dedupe_hotfix.sql FIRST. Cleaning up while sync is
-- still inserting ~75 copies per message is whack-a-mole.
--
-- THE ORPHAN PROBLEM
-- Six tables key off emails.id and NONE of them has a foreign key to public.emails:
--   email_bodies.email_id              (bigint — table is not in sql/, exists only in the DB)
--   email_attachments.email_id         (bigint, sql/2026-09-14_email_attachments_storage.sql)
--   email_contacts.email_id            (text,   sql/2026-08-16_emails_one_row_per_message_contacts.sql)
--   email_comments.email_id            (text,   sql/2026-08-11_email_comments.sql)
--   smart_scan_documents.source_email_id (bigint, sql/2026-09-15_smart_scan_documents.sql)
--   smart_scan_removed.source_email_id   (bigint, sql/2026-09-15_smart_scan_removed.sql)
-- With no FK there is no CASCADE and no error: DELETE just leaves those rows pointing at an id
-- that no longer exists, and the attachment / comment / scan silently disappears from the UI.
-- Which duplicate a dependent row points at is arbitrary — whichever copy happened to be
-- current when it was written — so dependents must be re-pointed at the keeper BEFORE deleting.
--
-- This is also why sql/2026-08-16_emails_collapse_duplicates_batched.sql should not be used
-- as-is: it only re-points email_contacts, ignoring the other five. It also orders keepers by
-- length(e.body_html), which detoasts every candidate row on a table with 189 GB of TOAST, and
-- re-runs a full GROUP BY over all 12.2M rows on every single batch.

-- ---------------------------------------------------------------------------
-- Section 1 — how much is real vs duplicate.
--
-- GROUP BY treats NULLs as equal (unlike the unique index, which is the whole bug), so this
-- groups on the intended key correctly. Should run as an index-only scan on
-- idx_emails_message_lead_keys (message_id, client_id, legacy_id, contact_id).
--
-- Scans ~12.2M index entries. If the SQL editor times out, run it in psql with
--   SET statement_timeout = 0;
-- ---------------------------------------------------------------------------
WITH grp AS (
  SELECT count(*) AS cnt
  FROM public.emails
  WHERE message_id IS NOT NULL
  GROUP BY message_id, client_id, legacy_id, contact_id
)
SELECT jsonb_pretty(jsonb_build_object(
  'rows_total',            (SELECT count(*) FROM public.emails),
  'rows_message_id_null',  (SELECT count(*) FROM public.emails WHERE message_id IS NULL),
  -- Real Graph messages. Compare against "5 months x 15 workers" to sanity-check the scale.
  'distinct_message_ids',  (SELECT count(DISTINCT message_id) FROM public.emails
                            WHERE message_id IS NOT NULL),
  'keeper_groups',         (SELECT count(*) FROM grp),
  'rows_in_groups',        (SELECT COALESCE(sum(cnt), 0) FROM grp),
  -- What a full dedupe at the current grain would remove.
  'deletable_rows',        (SELECT COALESCE(sum(cnt) - count(*), 0) FROM grp),
  'groups_with_dupes',     (SELECT count(*) FROM grp WHERE cnt > 1),
  'worst_group_rows',      (SELECT max(cnt) FROM grp)
)) AS cleanup_scale;


-- ---------------------------------------------------------------------------
-- Section 2 — orphan exposure. How many dependent rows hang off a row that is NOT the keeper
-- of its group, i.e. would be silently orphaned by a plain DELETE.
--
-- Bounded to the 20,000 most recent duplicate groups so it stays cheap. Treat the result as a
-- lower bound on exposure, not a total.
-- ---------------------------------------------------------------------------
WITH recent AS (
  SELECT id, message_id, client_id, legacy_id, contact_id
  FROM public.emails
  WHERE message_id IS NOT NULL
  ORDER BY id DESC
  LIMIT 400000
),
ranked AS (
  SELECT
    id,
    row_number() OVER (
      PARTITION BY message_id, client_id, legacy_id, contact_id
      ORDER BY id
    ) AS rn
  FROM recent
),
doomed AS (
  SELECT id FROM ranked WHERE rn > 1
),
keepers AS (
  SELECT id FROM ranked WHERE rn = 1
)
SELECT jsonb_pretty(jsonb_build_object(
  'sampled_rows',  (SELECT count(*) FROM recent),
  'keepers',       (SELECT count(*) FROM keepers),
  'doomed',        (SELECT count(*) FROM doomed),
  'dependents_on_doomed_rows', jsonb_build_object(
    'email_bodies',         (SELECT count(*) FROM public.email_bodies b
                             JOIN doomed d ON d.id = b.email_id),
    'email_attachments',    (SELECT count(*) FROM public.email_attachments a
                             JOIN doomed d ON d.id = a.email_id),
    'email_contacts',       (SELECT count(*) FROM public.email_contacts c
                             JOIN doomed d ON d.id::text = c.email_id),
    'email_comments',       (SELECT count(*) FROM public.email_comments m
                             JOIN doomed d ON d.id::text = m.email_id),
    'smart_scan_documents', (SELECT count(*) FROM public.smart_scan_documents s
                             JOIN doomed d ON d.id = s.source_email_id),
    'smart_scan_removed',   (SELECT count(*) FROM public.smart_scan_removed r
                             JOIN doomed d ON d.id = r.source_email_id)
  )
)) AS orphan_exposure;


-- ---------------------------------------------------------------------------
-- Section 4 — WHERE DOES THE 189 GB OF TOAST ACTUALLY LIVE? Run this before deciding to blank
-- body_html on non-keepers, because the answer may be "not in the duplicates".
--
-- The sync inserts body_html as '' (graphMailboxSyncService.js:2094 "Will be populated when
-- full body is fetched") and the body patch deliberately no longer writes it
-- (~line 2572 "Keep full HTML in email_bodies only"), setting only body_cached = true. So
-- recently inserted duplicates should hold NO body at all, and the 189 GB would instead sit in
-- older rows written before that change — which are the oldest ids, i.e. likely the KEEPERS.
-- If so, blanking non-keepers reclaims almost nothing and the space is in email_bodies /
-- attachments / old rows instead.
--
-- pg_column_size() forces a detoast, so this is deliberately bounded to 2,000 rows per end.
-- ---------------------------------------------------------------------------
WITH oldest AS (
  SELECT id, body_html, body_preview, attachments, body_cached
  FROM public.emails ORDER BY id ASC LIMIT 2000
),
newest AS (
  SELECT id, body_html, body_preview, attachments, body_cached
  FROM public.emails ORDER BY id DESC LIMIT 2000
),
shape AS (
  SELECT 'oldest_2000' AS band, * FROM oldest
  UNION ALL
  SELECT 'newest_2000' AS band, * FROM newest
)
SELECT jsonb_pretty(COALESCE(jsonb_object_agg(band, detail), '{}'::jsonb)) AS toast_location
FROM (
  SELECT
    band,
    jsonb_build_object(
      'id_from',           min(id),
      'id_to',             max(id),
      'rows_with_body',    count(*) FILTER (WHERE body_html IS NOT NULL AND body_html <> ''),
      'rows_body_cached',  count(*) FILTER (WHERE body_cached),
      'avg_body_bytes',    round(avg(pg_column_size(body_html))),
      'total_body',        pg_size_pretty(sum(pg_column_size(body_html))::bigint),
      'total_attachments', pg_size_pretty(sum(pg_column_size(attachments))::bigint),
      'total_preview',     pg_size_pretty(sum(pg_column_size(body_preview))::bigint)
    ) AS detail
  FROM shape
  GROUP BY band
) s;


-- ---------------------------------------------------------------------------
-- Section 5 — the 189 GB is NOT accounted for by live column data. Find out why.
--
-- Section 4 result:
--   newest 2,000 (id 17,333,746+): rows_with_body 0, body 1 byte/row, preview ~290 B,
--                                  attachments ~480 B  -> ~0.8 KB/row
--   oldest 2,000 (id 47,907+):     rows_with_body 657, body ~1,387 B, preview ~1.6 KB,
--                                  attachments ~14 B   -> ~3 KB/row
-- But 189 GB / 12.2M rows = ~15.5 KB/row. Neither end is close, so the space is either
--   (a) in the middle id range, written while patchMailboxEmailBody still wrote body_html, or
--   (b) DEAD TOAST that was never vacuumed — autovacuum on emails last completed 2026-09-22
--       and TOAST tables are vacuumed separately with their own statistics.
--
-- If it is (b), the fix is a VACUUM, not a delete, and no rows need to be touched at all.
-- ---------------------------------------------------------------------------

-- 5A) TOAST table bloat and vacuum history. Catalog-only, instant.
SELECT jsonb_pretty(jsonb_build_object(
  'toast_relation',   t.relname,
  'toast_size',       pg_size_pretty(pg_relation_size(t.oid)),
  'toast_reltuples',  t.reltuples::bigint,
  'toast_relpages',   t.relpages,
  'toast_n_live_tup', s.n_live_tup,
  'toast_n_dead_tup', s.n_dead_tup,
  'toast_last_vacuum',     s.last_vacuum,
  'toast_last_autovacuum', s.last_autovacuum,
  'toast_autovacuum_count', s.autovacuum_count,
  -- Live bytes implied by the chunk count: each TOAST chunk is ~2 KB, so this is the honest
  -- estimate of real data. A big gap vs toast_size means bloat, i.e. a VACUUM problem.
  'implied_live_bytes', pg_size_pretty((COALESCE(s.n_live_tup, 0) * 2048)::bigint)
)) AS toast_bloat
FROM pg_class c
JOIN pg_class t ON t.oid = c.reltoastrelid
LEFT JOIN pg_stat_all_tables s ON s.relid = t.oid
WHERE c.oid = 'public.emails'::regclass;


-- 5B) Body size across the middle of the id range, to find the era that wrote real bodies.
-- Each band is a bounded primary-key range scan of 1,500 rows.
WITH bands(band, lo) AS (
  VALUES ('id_02m', 2000000), ('id_05m', 5000000), ('id_08m', 8000000),
         ('id_11m', 11000000), ('id_14m', 14000000)
),
sampled AS (
  SELECT b.band, e.body_html, e.body_preview, e.attachments
  FROM bands b
  CROSS JOIN LATERAL (
    SELECT body_html, body_preview, attachments
    FROM public.emails
    WHERE id >= b.lo
    ORDER BY id
    LIMIT 1500
  ) e
)
SELECT jsonb_pretty(COALESCE(jsonb_object_agg(band, detail), '{}'::jsonb)) AS body_by_era
FROM (
  SELECT
    band,
    jsonb_build_object(
      'rows',              count(*),
      'rows_with_body',    count(*) FILTER (WHERE body_html IS NOT NULL AND body_html <> ''),
      'avg_body_bytes',    round(avg(pg_column_size(body_html))),
      'max_body_bytes',    max(pg_column_size(body_html)),
      'avg_attach_bytes',  round(avg(pg_column_size(attachments))),
      'avg_preview_bytes', round(avg(pg_column_size(body_preview)))
    ) AS detail
  FROM sampled
  GROUP BY band
) s;


-- ---------------------------------------------------------------------------
-- Section 3 — "emails that shouldn't be there" is a separate question from duplicates.
-- The sync now skips internal-to-internal, blocked senders and no-match messages
-- (graphMailboxSyncService.js logs those), but rows written before those filters remain.
-- Counts only; decide per category before deleting anything.
-- ---------------------------------------------------------------------------
SELECT jsonb_pretty(jsonb_build_object(
  -- Attached to nothing: no lead, no legacy lead, no contact. These are the clearest candidates.
  'unlinked_rows', (SELECT count(*) FROM public.emails
                    WHERE client_id IS NULL AND legacy_id IS NULL AND contact_id IS NULL),
  'unlinked_and_no_body', (SELECT count(*) FROM public.emails
                           WHERE client_id IS NULL AND legacy_id IS NULL AND contact_id IS NULL
                             AND (body_html IS NULL OR body_html = '')),
  'no_message_id', (SELECT count(*) FROM public.emails WHERE message_id IS NULL),
  'oldest_sent_at', (SELECT min(sent_at) FROM public.emails),
  'newest_sent_at', (SELECT max(sent_at) FROM public.emails),
  -- Rows dated before the CRM started syncing are worth eyeballing separately.
  'sent_before_2026', (SELECT count(*) FROM public.emails WHERE sent_at < '2026-01-01')
)) AS suspect_rows;
