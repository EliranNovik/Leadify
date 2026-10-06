-- READ-ONLY. One query, so the SQL editor shows its result directly.
--
-- This is the last piece of the Supabase error log that cannot be answered from the
-- application side: the real definition of "idx_email_attachments_message_att", which
-- raises 23505 roughly 120x/day from the backend Graph mail sync.
--
-- Already ruled out by runtime evidence:
--   * (email_id, graph_attachment_id) has no duplicates, so that constraint is fine.
--   * (message_id, attachment_id) has 244 duplicate pairs, so the failing index cannot be
--     a plain UNIQUE on that pair — it must be partial, or on an expression.
--
-- Paste the whole result back.

SELECT
  i.relname                 AS index_name,
  x.indisunique             AS is_unique,
  x.indisprimary            AS is_primary,
  pg_get_indexdef(x.indexrelid) AS definition
FROM pg_index x
JOIN pg_class i ON i.oid = x.indexrelid
WHERE x.indrelid = 'public.email_attachments'::regclass
ORDER BY x.indisunique DESC, i.relname;
