-- Batched collapse of duplicate emails (same Graph message_id).
-- Safe to re-run. Each call deletes up to p_batch_size extra rows.
--
-- Why not one DELETE: a window function over ~5M emails will time out / lock
-- the table in the SQL editor. Terminal psql with statement_timeout=0 is better,
-- but still run this in batches.
--
-- After deleted_count stays 0:
--   CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS emails_message_id_key
--     ON public.emails (message_id);
-- CONCURRENTLY cannot run inside a transaction.

CREATE OR REPLACE FUNCTION public.collapse_duplicate_emails_batch(p_batch_size integer DEFAULT 2000)
RETURNS TABLE (deleted_count integer, remaining_duplicate_message_ids bigint)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
SET statement_timeout = '120s'
AS $$
DECLARE
  v_deleted integer := 0;
  v_remaining bigint := 0;
BEGIN
  p_batch_size := LEAST(GREATEST(COALESCE(p_batch_size, 2000), 100), 5000);

  -- Preserve contact links on the keeper row before deleting extras.
  INSERT INTO public.email_contacts (email_id, contact_id)
  SELECT keeper.id::text, extra.contact_id
  FROM (
    SELECT e.message_id, e.id, e.contact_id
    FROM public.emails e
    WHERE e.message_id IS NOT NULL
      AND e.contact_id IS NOT NULL
      AND e.message_id IN (
        SELECT d.message_id
        FROM public.emails d
        WHERE d.message_id IS NOT NULL
        GROUP BY d.message_id
        HAVING COUNT(*) > 1
        LIMIT 200
      )
  ) extra
  INNER JOIN LATERAL (
    SELECT e.id
    FROM public.emails e
    WHERE e.message_id = extra.message_id
    ORDER BY
      (e.contact_id IS NOT NULL) DESC,
      (e.body_html IS NOT NULL AND length(e.body_html) > 0) DESC,
      e.sent_at ASC NULLS LAST,
      e.id ASC
    LIMIT 1
  ) keeper ON true
  WHERE keeper.id IS DISTINCT FROM extra.id
  ON CONFLICT (email_id, contact_id) DO NOTHING;

  WITH ranked AS (
    SELECT
      e.id,
      ROW_NUMBER() OVER (
        PARTITION BY e.message_id
        ORDER BY
          (e.contact_id IS NOT NULL) DESC,
          (e.body_html IS NOT NULL AND length(e.body_html) > 0) DESC,
          e.sent_at ASC NULLS LAST,
          e.id ASC
      ) AS rn
    FROM public.emails e
    WHERE e.message_id IN (
      SELECT d.message_id
      FROM public.emails d
      WHERE d.message_id IS NOT NULL
      GROUP BY d.message_id
      HAVING COUNT(*) > 1
      LIMIT 200
    )
  ),
  doomed AS (
    SELECT id FROM ranked WHERE rn > 1 LIMIT p_batch_size
  )
  DELETE FROM public.emails e
  USING doomed
  WHERE e.id = doomed.id;

  GET DIAGNOSTICS v_deleted = ROW_COUNT;

  SELECT COUNT(*) INTO v_remaining
  FROM (
    SELECT message_id
    FROM public.emails
    WHERE message_id IS NOT NULL
    GROUP BY message_id
    HAVING COUNT(*) > 1
  ) s;

  deleted_count := v_deleted;
  remaining_duplicate_message_ids := v_remaining;
  RETURN NEXT;
END;
$$;

GRANT EXECUTE ON FUNCTION public.collapse_duplicate_emails_batch(integer) TO service_role;

-- Preview how bad duplicates are (cheap-ish with existing message_id index).
-- SELECT COUNT(*) AS duplicate_message_ids
-- FROM (
--   SELECT message_id FROM public.emails
--   WHERE message_id IS NOT NULL
--   GROUP BY message_id
--   HAVING COUNT(*) > 1
-- ) s;

-- Run one batch:
-- SELECT * FROM public.collapse_duplicate_emails_batch(2000);

-- Loop in psql:
-- SELECT * FROM public.collapse_duplicate_emails_batch(2000);
-- (repeat until deleted_count = 0)
