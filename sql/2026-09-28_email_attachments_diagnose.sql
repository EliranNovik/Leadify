-- READ-ONLY diagnosis for the recurring 23505 on "idx_email_attachments_message_att".
-- Nothing here writes or locks anything. Run it in the Supabase SQL editor and paste the
-- output of all four sections back.
--
-- Context already established from the application side:
--   * email_attachments still carries the legacy attachment_id / file_name columns, so
--     withLegacyColumns() in emailAttachmentStorageService.js populates attachment_id.
--   * 177 of 642 sampled message_ids map to more than one public.emails row (up to 6),
--     because the schema intentionally allows one row per message_id + client_id /
--     legacy_id / contact_id.
--   * (email_id, graph_attachment_id) has 0 duplicates, so that constraint is doing its job.
--   * (message_id, attachment_id) has 244 duplicate pairs, so the failing index cannot be a
--     plain UNIQUE on that pair. Its real definition is needed, hence section 1.
--   * Of 415 sibling emails rows sharing a message_id with attachments, only 125 own an
--     attachment row, so the rest are retried on every sync cycle.

-- 1) The actual definition of every index and constraint on the table. THIS IS THE KEY ONE.
SELECT
  i.relname AS index_name,
  x.indisunique AS is_unique,
  x.indisprimary AS is_primary,
  pg_get_indexdef(x.indexrelid) AS definition
FROM pg_index x
JOIN pg_class i ON i.oid = x.indexrelid
WHERE x.indrelid = 'public.email_attachments'::regclass
ORDER BY x.indisunique DESC, i.relname;

SELECT
  conname AS constraint_name,
  contype AS type,
  pg_get_constraintdef(oid) AS definition
FROM pg_constraint
WHERE conrelid = 'public.email_attachments'::regclass
ORDER BY conname;


-- 2) Which columns are NOT NULL, and are the legacy ones still required?
SELECT column_name, data_type, is_nullable, column_default
FROM information_schema.columns
WHERE table_schema = 'public' AND table_name = 'email_attachments'
ORDER BY ordinal_position;


-- 3) Row shape: how much of the table uses the legacy column vs the new one.
SELECT
  count(*)                                                        AS total_rows,
  count(*) FILTER (WHERE attachment_id IS NULL)                   AS attachment_id_null,
  count(*) FILTER (WHERE graph_attachment_id IS NULL)              AS graph_attachment_id_null,
  count(*) FILTER (WHERE attachment_id IS DISTINCT FROM graph_attachment_id)
                                                                  AS legacy_differs_from_graph,
  count(*) FILTER (WHERE message_id IS NULL)                       AS message_id_null,
  count(*) FILTER (WHERE email_id IS NULL)                         AS email_id_null,
  count(*) FILTER (WHERE storage_path IS NULL)                     AS metadata_only_rows
FROM public.email_attachments;


-- 4) Confirm the fan-out starvation: emails rows that share a message_id with an email that
--    already has attachment rows, but own none themselves. These are the rows the sync keeps
--    retrying. Limited to recent rows so it stays cheap.
WITH recent AS (
  SELECT id, message_id
  FROM public.emails
  WHERE message_id IS NOT NULL
  ORDER BY id DESC
  LIMIT 20000
),
fanned AS (
  SELECT message_id, count(*) AS email_rows, array_agg(id ORDER BY id) AS email_ids
  FROM recent
  GROUP BY message_id
  HAVING count(*) > 1
)
SELECT
  count(*)                                                   AS fanned_message_ids,
  sum(f.email_rows)                                          AS sibling_email_rows,
  sum((SELECT count(DISTINCT a.email_id)
       FROM public.email_attachments a
       WHERE a.message_id = f.message_id))                   AS siblings_owning_attachments
FROM fanned f;
