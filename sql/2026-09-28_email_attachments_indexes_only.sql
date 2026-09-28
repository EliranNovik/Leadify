-- READ-ONLY. ONE statement only, so the Supabase SQL editor returns exactly this result set.
-- This is the missing piece: the real definition of "idx_email_attachments_message_att".

SELECT
  i.relname                                        AS index_name,
  x.indisunique                                    AS is_unique,
  pg_get_indexdef(x.indexrelid)                    AS definition
FROM pg_index x
JOIN pg_class i ON i.oid = x.indexrelid
WHERE x.indrelid = 'public.email_attachments'::regclass
ORDER BY x.indisunique DESC, i.relname;
