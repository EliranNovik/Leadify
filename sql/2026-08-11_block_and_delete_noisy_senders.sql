-- Block noisy senders at the DB layer + delete existing rows.
-- Run via psql (session pooler), NOT the SQL editor — deletes are huge.
--
--   export DATABASE_URL='postgresql://postgres.PROJECT:PASSWORD@aws-0-eu-central-1.pooler.supabase.com:5432/postgres?gssencmode=disable&sslmode=require'
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f sql/2026-08-11_block_and_delete_noisy_senders.sql

SET statement_timeout TO '0';

-- ---------------------------------------------------------------------------
-- 1) Block list table
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.blocked_email_senders (
  sender_email text PRIMARY KEY,
  reason text,
  created_at timestamptz NOT NULL DEFAULT now()
);

INSERT INTO public.blocked_email_senders (sender_email, reason) VALUES
  ('artalegal@googlegroups.com', 'noise / mass mailer'),
  ('alljobs@alljob.co.il', 'noise / job alerts'),
  ('info@crocoblock.com', 'noise / marketing')
ON CONFLICT (sender_email) DO NOTHING;

-- ---------------------------------------------------------------------------
-- 2) Reject (quietly skip) inserts/updates with blocked sender_email
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.reject_blocked_email_sender()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.sender_email IS NOT NULL
     AND EXISTS (
       SELECT 1
       FROM public.blocked_email_senders b
       WHERE b.sender_email = lower(btrim(NEW.sender_email))
     )
  THEN
    -- BEFORE ROW: NULL skips the insert/update without aborting the statement batch
    RETURN NULL;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_reject_blocked_email_sender ON public.emails;
CREATE TRIGGER trg_reject_blocked_email_sender
  BEFORE INSERT OR UPDATE OF sender_email ON public.emails
  FOR EACH ROW
  EXECUTE FUNCTION public.reject_blocked_email_sender();

GRANT SELECT ON public.blocked_email_senders TO anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 3) Delete existing rows (batched; uses sender_email index)
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  v_deleted integer;
  v_total bigint := 0;
  v_sender text;
  v_senders text[] := ARRAY[
    'artalegal@googlegroups.com',
    'alljobs@alljob.co.il',
    'info@crocoblock.com'
  ];
BEGIN
  FOREACH v_sender IN ARRAY v_senders LOOP
    LOOP
      DELETE FROM public.emails
      WHERE ctid IN (
        SELECT ctid
        FROM public.emails
        WHERE sender_email = v_sender
        LIMIT 5000
      );
      GET DIAGNOSTICS v_deleted = ROW_COUNT;
      v_total := v_total + v_deleted;
      EXIT WHEN v_deleted = 0;
      RAISE NOTICE 'deleted % rows for % (running total %)', v_deleted, v_sender, v_total;
    END LOOP;
  END LOOP;
  RAISE NOTICE 'DONE — deleted % total rows', v_total;
END $$;

-- Verify
SELECT sender_email, COUNT(*) AS remaining
FROM public.emails
WHERE sender_email IN (
  'artalegal@googlegroups.com',
  'alljobs@alljob.co.il',
  'info@crocoblock.com'
)
GROUP BY 1
ORDER BY 1;

SELECT * FROM public.blocked_email_senders
WHERE sender_email IN (
  'artalegal@googlegroups.com',
  'alljobs@alljob.co.il',
  'info@crocoblock.com'
)
ORDER BY sender_email;
