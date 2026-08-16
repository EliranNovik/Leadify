-- One emails row per Graph message; attach contacts via email_contacts.
--
-- 5M-row table: do NOT collapse duplicates in this file.
-- Run THIS file first (seconds). Then optionally run
-- sql/2026-08-16_emails_collapse_duplicates_batched.sql in a loop.
--
-- Do not CREATE UNIQUE INDEX on emails(message_id) until duplicates are gone.
-- New backend code already inserts only one row per message_id.

-- ---------------------------------------------------------------------------
-- 1) Junction: email ↔ contacts
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.email_contacts (
  email_id text NOT NULL,
  contact_id bigint NOT NULL REFERENCES public.leads_contact (id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (email_id, contact_id)
);

CREATE INDEX IF NOT EXISTS idx_email_contacts_contact_id
  ON public.email_contacts (contact_id);

COMMENT ON TABLE public.email_contacts IS
  'Links a single emails row to every CRM contact on the thread. Used so one message can show on every lead that shares those contacts.';

ALTER TABLE public.email_contacts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "email_contacts_select_employees" ON public.email_contacts;
CREATE POLICY "email_contacts_select_employees"
  ON public.email_contacts
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.users u
      WHERE u.auth_id = auth.uid()
        AND u.employee_id IS NOT NULL
    )
  );

DROP POLICY IF EXISTS "email_contacts_insert_employees" ON public.email_contacts;
CREATE POLICY "email_contacts_insert_employees"
  ON public.email_contacts
  FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.users u
      WHERE u.auth_id = auth.uid()
        AND u.employee_id IS NOT NULL
    )
  );

GRANT SELECT, INSERT, UPDATE, DELETE ON public.email_contacts TO service_role;
GRANT SELECT, INSERT ON public.email_contacts TO authenticated;

ALTER TABLE public.emails
  ADD COLUMN IF NOT EXISTS internet_message_id text;

-- ---------------------------------------------------------------------------
-- 2) Timeline RPC: also return emails linked through email_contacts
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.email_lead_timeline(
  p_client_id uuid DEFAULT NULL,
  p_legacy_id bigint DEFAULT NULL,
  p_contact_ids bigint[] DEFAULT NULL,
  p_sender_emails text[] DEFAULT NULL,
  p_limit integer DEFAULT 200,
  p_lookback_days integer DEFAULT 365
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
SET row_security = off
SET statement_timeout = '20s'
AS $$
DECLARE
  v_limit integer := LEAST(GREATEST(COALESCE(p_limit, 200), 1), 500);
  v_since timestamptz := now() - make_interval(days => LEAST(GREATEST(COALESCE(p_lookback_days, 365), 1), 730));
  v_senders text[];
  v_has_scope boolean;
  v_has_senders boolean;
  v_has_contacts boolean;
BEGIN
  IF p_sender_emails IS NOT NULL AND cardinality(p_sender_emails) > 0 THEN
    SELECT array_agg(DISTINCT lower(btrim(x)))
      INTO v_senders
    FROM unnest(p_sender_emails) AS x
    WHERE btrim(COALESCE(x, '')) <> ''
      AND position('@' in btrim(x)) > 0;
  END IF;

  v_has_contacts := p_contact_ids IS NOT NULL AND cardinality(p_contact_ids) > 0;
  v_has_scope :=
    p_client_id IS NOT NULL
    OR p_legacy_id IS NOT NULL
    OR v_has_contacts;
  v_has_senders := v_senders IS NOT NULL AND cardinality(v_senders) > 0;

  IF NOT v_has_scope AND NOT v_has_senders THEN
    RETURN '[]'::jsonb;
  END IF;

  RETURN COALESCE((
    SELECT jsonb_agg(to_jsonb(r) ORDER BY r.sent_at DESC)
    FROM (
      SELECT
        d.id,
        d.message_id,
        d.subject,
        d.sent_at,
        d.direction,
        d.sender_email,
        d.recipient_list,
        d.body_preview,
        NULL::jsonb AS attachments,
        d.contact_id,
        d.client_id,
        d.legacy_id,
        d.sender_name
      FROM (
        SELECT DISTINCT ON (u.id)
          u.id, u.message_id, u.subject, u.sent_at, u.direction,
          u.sender_email, u.recipient_list, u.body_preview,
          u.contact_id, u.client_id, u.legacy_id, u.sender_name
        FROM (
          (
            SELECT
              e.id, e.message_id, e.subject, e.sent_at, e.direction,
              e.sender_email, e.recipient_list, e.body_preview,
              e.contact_id, e.client_id, e.legacy_id, e.sender_name
            FROM public.emails e
            WHERE p_client_id IS NOT NULL
              AND e.client_id = p_client_id
            ORDER BY e.sent_at DESC
            LIMIT v_limit
          )
          UNION ALL
          (
            SELECT
              e.id, e.message_id, e.subject, e.sent_at, e.direction,
              e.sender_email, e.recipient_list, e.body_preview,
              e.contact_id, e.client_id, e.legacy_id, e.sender_name
            FROM public.emails e
            WHERE p_legacy_id IS NOT NULL
              AND e.legacy_id = p_legacy_id
            ORDER BY e.sent_at DESC
            LIMIT v_limit
          )
          UNION ALL
          (
            SELECT
              e.id, e.message_id, e.subject, e.sent_at, e.direction,
              e.sender_email, e.recipient_list, e.body_preview,
              e.contact_id, e.client_id, e.legacy_id, e.sender_name
            FROM public.emails e
            WHERE v_has_contacts
              AND e.contact_id = ANY (p_contact_ids)
            ORDER BY e.sent_at DESC
            LIMIT v_limit
          )
          UNION ALL
          (
            SELECT
              e.id, e.message_id, e.subject, e.sent_at, e.direction,
              e.sender_email, e.recipient_list, e.body_preview,
              e.contact_id, e.client_id, e.legacy_id, e.sender_name
            FROM public.emails e
            INNER JOIN public.email_contacts ec ON ec.email_id = e.id::text
            WHERE v_has_contacts
              AND ec.contact_id = ANY (p_contact_ids)
            ORDER BY e.sent_at DESC
            LIMIT v_limit
          )
          UNION ALL
          (
            SELECT
              e.id, e.message_id, e.subject, e.sent_at, e.direction,
              e.sender_email, e.recipient_list, e.body_preview,
              e.contact_id, e.client_id, e.legacy_id, e.sender_name
            FROM public.emails e
            WHERE v_has_senders
              AND e.sender_email = ANY (v_senders)
              AND e.sender_email IS NOT NULL
              AND btrim(e.sender_email) <> ''
              AND e.sent_at >= v_since
            ORDER BY e.sent_at DESC
            LIMIT v_limit
          )
        ) u
        ORDER BY u.id, u.sent_at DESC
      ) d
      ORDER BY d.sent_at DESC
      LIMIT v_limit
    ) r
  ), '[]'::jsonb);
END;
$$;

GRANT EXECUTE ON FUNCTION public.email_lead_timeline(uuid, bigint, bigint[], text[], integer, integer)
  TO anon, authenticated, service_role;

NOTIFY pgrst, 'reload schema';
