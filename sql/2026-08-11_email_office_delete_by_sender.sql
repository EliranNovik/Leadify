-- Fast batched delete of emails from one sender (EmailThreadLeadPage Actions).
-- CRITICAL: idx_emails_sender_email_sent_at is PARTIAL:
--   WHERE sender_email IS NOT NULL AND btrim(sender_email) <> ''
-- Queries MUST include that predicate or Postgres seq-scans the whole table (57014).
-- Returns number deleted in this batch; call repeatedly until 0.
-- Run via psql (session pooler). Safe to re-run.

SET statement_timeout TO '0';

DROP FUNCTION IF EXISTS public.email_office_delete_by_sender(text, integer);
DROP FUNCTION IF EXISTS public.email_office_delete_ids(bigint[]);

CREATE FUNCTION public.email_office_delete_ids(p_ids bigint[])
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
SET row_security = off
AS $$
DECLARE
  v_deleted integer := 0;
BEGIN
  IF p_ids IS NULL OR cardinality(p_ids) = 0 THEN
    RETURN 0;
  END IF;

  PERFORM set_config('statement_timeout', '15s', true);

  DELETE FROM public.emails e
  WHERE e.id = ANY (p_ids);

  GET DIAGNOSTICS v_deleted = ROW_COUNT;
  RETURN v_deleted;
END;
$$;

CREATE FUNCTION public.email_office_delete_by_sender(
  p_sender_email text,
  p_limit integer DEFAULT 50
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
SET row_security = off
AS $$
DECLARE
  v_raw text := btrim(COALESCE(p_sender_email, ''));
  v_lower text := lower(v_raw);
  v_limit integer := LEAST(GREATEST(COALESCE(p_limit, 50), 1), 200);
  v_deleted integer := 0;
BEGIN
  IF v_raw = '' OR position('@' in v_raw) = 0 THEN
    RETURN 0;
  END IF;

  PERFORM set_config('statement_timeout', '15s', true);

  -- Predicate mirrors partial index so Index Scan is used (not Seq Scan).
  WITH doomed AS (
    SELECT e2.id
    FROM public.emails e2
    WHERE e2.sender_email = v_lower
      AND e2.sender_email IS NOT NULL
      AND btrim(e2.sender_email) <> ''
    ORDER BY e2.sent_at DESC
    LIMIT v_limit
  )
  DELETE FROM public.emails e
  USING doomed
  WHERE e.id = doomed.id;

  GET DIAGNOSTICS v_deleted = ROW_COUNT;

  IF v_deleted = 0 AND v_raw <> v_lower THEN
    WITH doomed AS (
      SELECT e2.id
      FROM public.emails e2
      WHERE e2.sender_email = v_raw
        AND e2.sender_email IS NOT NULL
        AND btrim(e2.sender_email) <> ''
      ORDER BY e2.sent_at DESC
      LIMIT v_limit
    )
    DELETE FROM public.emails e
    USING doomed
    WHERE e.id = doomed.id;

    GET DIAGNOSTICS v_deleted = ROW_COUNT;
  END IF;

  RETURN v_deleted;
END;
$$;

GRANT EXECUTE ON FUNCTION public.email_office_delete_ids(bigint[]) TO authenticated, anon, service_role;
GRANT EXECUTE ON FUNCTION public.email_office_delete_by_sender(text, integer) TO authenticated, anon, service_role;

SELECT
  p.proname,
  pg_get_function_identity_arguments(p.oid) AS args
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public'
  AND p.proname IN ('email_office_delete_by_sender', 'email_office_delete_ids')
ORDER BY 1;
