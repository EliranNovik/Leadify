-- Public client self-scheduling (Calendly-style) per lead.
-- Run in Supabase SQL editor after client_portal.sql.

CREATE TABLE IF NOT EXISTS public.lead_meeting_booking_settings (
  id BIGSERIAL PRIMARY KEY,
  booking_token UUID NOT NULL DEFAULT gen_random_uuid() UNIQUE,
  new_lead_id UUID,
  legacy_lead_id BIGINT,
  enabled BOOLEAN NOT NULL DEFAULT FALSE,
  title TEXT NOT NULL DEFAULT 'Schedule a meeting',
  description TEXT,
  duration_minutes INT NOT NULL DEFAULT 30,
  meeting_location TEXT,
  meeting_location_id INT,
  host_employee_id BIGINT,
  meeting_manager TEXT,
  calendar_type TEXT NOT NULL DEFAULT 'potential_client'
    CHECK (calendar_type IN ('potential_client', 'active_client')),
  buffer_minutes INT NOT NULL DEFAULT 0,
  min_notice_hours INT NOT NULL DEFAULT 24,
  max_days_ahead INT NOT NULL DEFAULT 60,
  slot_interval_minutes INT NOT NULL DEFAULT 30,
  business_hours_start TIME NOT NULL DEFAULT '09:00',
  business_hours_end TIME NOT NULL DEFAULT '17:00',
  days_of_week INT[] NOT NULL DEFAULT ARRAY[0, 1, 2, 3, 4],
  send_email BOOLEAN NOT NULL DEFAULT TRUE,
  send_whatsapp BOOLEAN NOT NULL DEFAULT TRUE,
  send_calendar_invite BOOLEAN NOT NULL DEFAULT TRUE,
  timezone TEXT NOT NULL DEFAULT 'Asia/Jerusalem',
  created_by_user_id UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT lead_meeting_booking_one_lead CHECK (
    (new_lead_id IS NOT NULL AND legacy_lead_id IS NULL)
    OR (new_lead_id IS NULL AND legacy_lead_id IS NOT NULL)
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_lead_meeting_booking_new_lead
  ON public.lead_meeting_booking_settings (new_lead_id)
  WHERE new_lead_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_lead_meeting_booking_legacy_lead
  ON public.lead_meeting_booking_settings (legacy_lead_id)
  WHERE legacy_lead_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_lead_meeting_booking_token
  ON public.lead_meeting_booking_settings (booking_token)
  WHERE enabled = TRUE;

ALTER TABLE public.lead_meeting_booking_settings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS lead_meeting_booking_staff_all ON public.lead_meeting_booking_settings;
CREATE POLICY lead_meeting_booking_staff_all
  ON public.lead_meeting_booking_settings
  FOR ALL
  TO authenticated
  USING (TRUE)
  WITH CHECK (TRUE);

-- ---------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public._booking_settings_by_token(p_token UUID)
RETURNS public.lead_meeting_booking_settings
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT s.*
  FROM public.lead_meeting_booking_settings s
  WHERE s.booking_token = p_token
    AND s.enabled = TRUE
  LIMIT 1;
$$;

CREATE OR REPLACE FUNCTION public._booking_lead_contacts(
  p_new_lead_id UUID,
  p_legacy_lead_id BIGINT
)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_contacts JSONB;
BEGIN
  IF p_legacy_lead_id IS NOT NULL THEN
    SELECT COALESCE(jsonb_agg(row_to_json(t)::JSONB ORDER BY t.is_main DESC, t.id), '[]'::JSONB)
    INTO v_contacts
    FROM (
      SELECT
        lc.id,
        lc.name,
        lc.mobile,
        lc.phone,
        lc.email,
        (llc.main::TEXT IN ('true', 't', '1')) AS is_main
      FROM public.lead_leadcontact llc
      INNER JOIN public.leads_contact lc ON lc.id::TEXT = llc.contact_id::TEXT
      WHERE llc.lead_id::TEXT = p_legacy_lead_id::TEXT
    ) t;
  ELSE
    SELECT COALESCE(jsonb_agg(row_to_json(t)::JSONB ORDER BY t.is_main DESC, t.id), '[]'::JSONB)
    INTO v_contacts
    FROM (
      SELECT
        lc.id,
        lc.name,
        lc.mobile,
        lc.phone,
        lc.email,
        (llc.main::TEXT IN ('true', 't', '1')) AS is_main
      FROM public.lead_leadcontact llc
      INNER JOIN public.leads_contact lc ON lc.id::TEXT = llc.contact_id::TEXT
      WHERE llc.newlead_id::TEXT = p_new_lead_id::TEXT

      UNION ALL

      SELECT
        lc.id,
        lc.name,
        lc.mobile,
        lc.phone,
        lc.email,
        FALSE AS is_main
      FROM public.leads_contact lc
      WHERE lc.newlead_id::TEXT = p_new_lead_id::TEXT
        AND NOT EXISTS (
          SELECT 1
          FROM public.lead_leadcontact llc
          WHERE llc.contact_id::TEXT = lc.id::TEXT
            AND llc.newlead_id::TEXT = p_new_lead_id::TEXT
        )
    ) t;
  END IF;

  RETURN COALESCE(v_contacts, '[]'::JSONB);
END;
$$;

-- ---------------------------------------------------------------------------
-- Public RPC (anon via backend service role)
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.get_public_booking_config(p_token UUID)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_settings public.lead_meeting_booking_settings;
  v_lead_number TEXT;
  v_display_name TEXT;
  v_category TEXT;
  v_language_id INT;
  v_host_name TEXT;
  v_host_photo TEXT;
  v_location_name TEXT;
BEGIN
  v_settings := public._booking_settings_by_token(p_token);
  IF v_settings IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Booking link not found or disabled');
  END IF;

  IF v_settings.legacy_lead_id IS NOT NULL THEN
    SELECT ll.lead_number::TEXT, ll.name, mc.name, ll.language_id
    INTO v_lead_number, v_display_name, v_category, v_language_id
    FROM public.leads_lead ll
    LEFT JOIN public.misc_category mc ON mc.id = ll.category_id
    WHERE ll.id = v_settings.legacy_lead_id;
  ELSE
    SELECT l.lead_number::TEXT, l.name, mc.name, l.language_id
    INTO v_lead_number, v_display_name, v_category, v_language_id
    FROM public.leads l
    LEFT JOIN public.misc_category mc ON mc.id = l.category_id
    WHERE l.id = v_settings.new_lead_id;
  END IF;

  IF v_settings.host_employee_id IS NOT NULL THEN
    SELECT te.display_name, te.photo_url
    INTO v_host_name, v_host_photo
    FROM public.tenants_employee te
    WHERE te.id = v_settings.host_employee_id;
  END IF;

  IF v_settings.meeting_location_id IS NOT NULL THEN
    SELECT tml.name INTO v_location_name
    FROM public.tenants_meetinglocation tml
    WHERE tml.id = v_settings.meeting_location_id;
  END IF;

  RETURN jsonb_build_object(
    'ok', true,
    'settings', jsonb_build_object(
      'title', v_settings.title,
      'description', v_settings.description,
      'duration_minutes', v_settings.duration_minutes,
      'location_options', jsonb_build_array('Teams', 'Ramat Gan Office'),
      'buffer_minutes', v_settings.buffer_minutes,
      'min_notice_hours', v_settings.min_notice_hours,
      'max_days_ahead', v_settings.max_days_ahead,
      'slot_interval_minutes', v_settings.slot_interval_minutes,
      'business_hours_start', to_char(v_settings.business_hours_start, 'HH24:MI'),
      'business_hours_end', to_char(v_settings.business_hours_end, 'HH24:MI'),
      'days_of_week', v_settings.days_of_week,
      'timezone', v_settings.timezone,
      'send_email', v_settings.send_email,
      'send_whatsapp', v_settings.send_whatsapp
    ),
    'lead', jsonb_build_object(
      'lead_number', v_lead_number,
      'lead_ref', v_lead_number,
      'display_name', v_display_name,
      'category', v_category,
      'language_id', v_language_id,
      'is_legacy', v_settings.legacy_lead_id IS NOT NULL
    ),
    'host', jsonb_build_object(
      'name', COALESCE(v_host_name, v_settings.meeting_manager),
      'photo_url', v_host_photo
    ),
    'contacts', public._booking_lead_contacts(v_settings.new_lead_id, v_settings.legacy_lead_id)
  );
END;
$$;

-- Upcoming / scheduled meetings for the lead tied to a public booking link (no login required).
CREATE OR REPLACE FUNCTION public.get_public_booking_meetings(p_token UUID)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_settings public.lead_meeting_booking_settings;
  v_meetings JSONB;
  v_today DATE := CURRENT_DATE;
BEGIN
  v_settings := public._booking_settings_by_token(p_token);
  IF v_settings IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Booking link not found or disabled');
  END IF;

  IF v_settings.new_lead_id IS NOT NULL THEN
    SELECT COALESCE(
      jsonb_agg(
        jsonb_build_object(
          'id', m.id,
          'meeting_date', m.meeting_date,
          'meeting_time', m.meeting_time::TEXT,
          'meeting_location', NULLIF(TRIM(m.meeting_location), ''),
          'meeting_subject', NULLIF(TRIM(m.meeting_subject), ''),
          'join_url', NULLIF(
            COALESCE(NULLIF(TRIM(m.custom_link), ''), NULLIF(TRIM(m.teams_meeting_url), '')),
            ''
          ),
          'status', COALESCE(NULLIF(TRIM(m.status), ''), 'scheduled'),
          'booked_via_client_link', COALESCE(m.scheduler, '') = 'Client booking',
          'created_at', m.created_at
        )
        ORDER BY m.meeting_date ASC NULLS LAST, m.meeting_time ASC NULLS LAST
      ),
      '[]'::JSONB
    )
    INTO v_meetings
    FROM public.meetings m
    WHERE m.client_id = v_settings.new_lead_id
      AND m.meeting_date IS NOT NULL
      AND m.meeting_date >= v_today
      AND COALESCE(NULLIF(TRIM(m.status), ''), 'scheduled') NOT IN ('canceled', 'cancelled', 'completed');
  ELSE
    SELECT COALESCE(
      jsonb_agg(row_data ORDER BY sort_date ASC NULLS LAST, sort_time ASC NULLS LAST),
      '[]'::JSONB
    )
    INTO v_meetings
    FROM (
      SELECT
        jsonb_build_object(
          'id', m.id,
          'meeting_date', m.meeting_date,
          'meeting_time', m.meeting_time::TEXT,
          'meeting_location', NULLIF(TRIM(m.meeting_location), ''),
          'meeting_subject', NULLIF(TRIM(m.meeting_subject), ''),
          'join_url', NULLIF(
            COALESCE(NULLIF(TRIM(m.custom_link), ''), NULLIF(TRIM(m.teams_meeting_url), '')),
            ''
          ),
          'status', COALESCE(NULLIF(TRIM(m.status), ''), 'scheduled'),
          'booked_via_client_link', COALESCE(m.scheduler, '') = 'Client booking',
          'created_at', m.created_at
        ) AS row_data,
        m.meeting_date AS sort_date,
        m.meeting_time AS sort_time
      FROM public.meetings m
      WHERE m.legacy_lead_id = v_settings.legacy_lead_id
        AND m.meeting_date IS NOT NULL
        AND m.meeting_date >= v_today
        AND COALESCE(NULLIF(TRIM(m.status), ''), 'scheduled') NOT IN ('canceled', 'cancelled', 'completed')
    ) combined;
  END IF;

  RETURN jsonb_build_object(
    'ok', true,
    'meetings', COALESCE(v_meetings, '[]'::JSONB)
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.get_public_booking_context(p_token UUID)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_settings public.lead_meeting_booking_settings;
BEGIN
  v_settings := public._booking_settings_by_token(p_token);
  IF v_settings IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Booking link not found or disabled');
  END IF;

  RETURN jsonb_build_object(
    'ok', true,
    'settings', row_to_json(v_settings)::JSONB
  );
END;
$$;

-- ---------------------------------------------------------------------------
-- Staff RPCs
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.staff_get_lead_booking_settings(
  p_lead_id TEXT,
  p_lead_type TEXT DEFAULT 'new'
)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_new_lead_id UUID;
  v_legacy_lead_id BIGINT;
  v_row public.lead_meeting_booking_settings;
BEGIN
  IF lower(coalesce(p_lead_type, '')) = 'legacy' OR p_lead_id ~ '^legacy_' OR p_lead_id ~ '^\d+$' THEN
    v_legacy_lead_id := CASE
      WHEN p_lead_id ~ '^legacy_' THEN NULLIF(regexp_replace(p_lead_id, '^legacy_', ''), '')::BIGINT
      ELSE p_lead_id::BIGINT
    END;
  ELSE
    v_new_lead_id := p_lead_id::UUID;
  END IF;

  SELECT * INTO v_row
  FROM public.lead_meeting_booking_settings s
  WHERE (v_new_lead_id IS NOT NULL AND s.new_lead_id = v_new_lead_id)
     OR (v_legacy_lead_id IS NOT NULL AND s.legacy_lead_id = v_legacy_lead_id)
  LIMIT 1;

  IF v_row IS NULL THEN
    RETURN jsonb_build_object('ok', true, 'settings', NULL);
  END IF;

  RETURN jsonb_build_object(
    'ok', true,
    'settings', row_to_json(v_row)::JSONB,
    'booking_url_path', '/book/' || v_row.booking_token::TEXT
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.staff_upsert_lead_booking_settings(
  p_lead_id TEXT,
  p_lead_type TEXT,
  p_payload JSONB
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_new_lead_id UUID;
  v_legacy_lead_id BIGINT;
  v_row public.lead_meeting_booking_settings;
  v_id BIGINT;
BEGIN
  IF lower(coalesce(p_lead_type, '')) = 'legacy' OR p_lead_id ~ '^legacy_' OR p_lead_id ~ '^\d+$' THEN
    v_legacy_lead_id := CASE
      WHEN p_lead_id ~ '^legacy_' THEN NULLIF(regexp_replace(p_lead_id, '^legacy_', ''), '')::BIGINT
      ELSE p_lead_id::BIGINT
    END;
  ELSE
    v_new_lead_id := p_lead_id::UUID;
  END IF;

  SELECT * INTO v_row
  FROM public.lead_meeting_booking_settings s
  WHERE (v_new_lead_id IS NOT NULL AND s.new_lead_id = v_new_lead_id)
     OR (v_legacy_lead_id IS NOT NULL AND s.legacy_lead_id = v_legacy_lead_id)
  LIMIT 1;

  IF v_row IS NULL THEN
    INSERT INTO public.lead_meeting_booking_settings (
      new_lead_id,
      legacy_lead_id,
      enabled,
      title,
      description,
      duration_minutes,
      meeting_location,
      meeting_location_id,
      host_employee_id,
      meeting_manager,
      calendar_type,
      buffer_minutes,
      min_notice_hours,
      max_days_ahead,
      slot_interval_minutes,
      business_hours_start,
      business_hours_end,
      days_of_week,
      send_email,
      send_whatsapp,
      send_calendar_invite,
      timezone
    ) VALUES (
      v_new_lead_id,
      v_legacy_lead_id,
      COALESCE((p_payload->>'enabled')::BOOLEAN, FALSE),
      COALESCE(NULLIF(trim(p_payload->>'title'), ''), 'Schedule a meeting'),
      NULLIF(trim(p_payload->>'description'), ''),
      COALESCE((p_payload->>'duration_minutes')::INT, 30),
      NULLIF(trim(p_payload->>'meeting_location'), ''),
      CASE WHEN p_payload ? 'meeting_location_id' AND (p_payload->>'meeting_location_id') ~ '^\d+$'
        THEN (p_payload->>'meeting_location_id')::INT ELSE NULL END,
      CASE WHEN p_payload ? 'host_employee_id' AND (p_payload->>'host_employee_id') ~ '^\d+$'
        THEN (p_payload->>'host_employee_id')::BIGINT ELSE NULL END,
      NULLIF(trim(p_payload->>'meeting_manager'), ''),
      COALESCE(NULLIF(trim(p_payload->>'calendar_type'), ''), 'potential_client'),
      COALESCE((p_payload->>'buffer_minutes')::INT, 0),
      COALESCE((p_payload->>'min_notice_hours')::INT, 24),
      COALESCE((p_payload->>'max_days_ahead')::INT, 60),
      COALESCE((p_payload->>'slot_interval_minutes')::INT, 30),
      COALESCE((p_payload->>'business_hours_start')::TIME, '09:00'::TIME),
      COALESCE((p_payload->>'business_hours_end')::TIME, '17:00'::TIME),
      COALESCE(
        ARRAY(SELECT jsonb_array_elements_text(p_payload->'days_of_week')::INT),
        ARRAY[0, 1, 2, 3, 4]
      ),
      COALESCE((p_payload->>'send_email')::BOOLEAN, TRUE),
      COALESCE((p_payload->>'send_whatsapp')::BOOLEAN, TRUE),
      COALESCE((p_payload->>'send_calendar_invite')::BOOLEAN, TRUE),
      COALESCE(NULLIF(trim(p_payload->>'timezone'), ''), 'Asia/Jerusalem')
    )
    RETURNING id INTO v_id;
  ELSE
    UPDATE public.lead_meeting_booking_settings
    SET
      enabled = COALESCE((p_payload->>'enabled')::BOOLEAN, enabled),
      title = COALESCE(NULLIF(trim(p_payload->>'title'), ''), title),
      description = CASE WHEN p_payload ? 'description' THEN NULLIF(trim(p_payload->>'description'), '') ELSE description END,
      duration_minutes = COALESCE((p_payload->>'duration_minutes')::INT, duration_minutes),
      meeting_location = CASE WHEN p_payload ? 'meeting_location' THEN NULLIF(trim(p_payload->>'meeting_location'), '') ELSE meeting_location END,
      meeting_location_id = CASE WHEN p_payload ? 'meeting_location_id' THEN
        CASE WHEN (p_payload->>'meeting_location_id') ~ '^\d+$' THEN (p_payload->>'meeting_location_id')::INT ELSE NULL END
        ELSE meeting_location_id END,
      host_employee_id = CASE WHEN p_payload ? 'host_employee_id' THEN
        CASE WHEN (p_payload->>'host_employee_id') ~ '^\d+$' THEN (p_payload->>'host_employee_id')::BIGINT ELSE NULL END
        ELSE host_employee_id END,
      meeting_manager = CASE WHEN p_payload ? 'meeting_manager' THEN NULLIF(trim(p_payload->>'meeting_manager'), '') ELSE meeting_manager END,
      calendar_type = COALESCE(NULLIF(trim(p_payload->>'calendar_type'), ''), calendar_type),
      buffer_minutes = COALESCE((p_payload->>'buffer_minutes')::INT, buffer_minutes),
      min_notice_hours = COALESCE((p_payload->>'min_notice_hours')::INT, min_notice_hours),
      max_days_ahead = COALESCE((p_payload->>'max_days_ahead')::INT, max_days_ahead),
      slot_interval_minutes = COALESCE((p_payload->>'slot_interval_minutes')::INT, slot_interval_minutes),
      business_hours_start = COALESCE((p_payload->>'business_hours_start')::TIME, business_hours_start),
      business_hours_end = COALESCE((p_payload->>'business_hours_end')::TIME, business_hours_end),
      days_of_week = CASE WHEN p_payload ? 'days_of_week' THEN
        ARRAY(SELECT jsonb_array_elements_text(p_payload->'days_of_week')::INT)
        ELSE days_of_week END,
      send_email = COALESCE((p_payload->>'send_email')::BOOLEAN, send_email),
      send_whatsapp = COALESCE((p_payload->>'send_whatsapp')::BOOLEAN, send_whatsapp),
      send_calendar_invite = COALESCE((p_payload->>'send_calendar_invite')::BOOLEAN, send_calendar_invite),
      timezone = COALESCE(NULLIF(trim(p_payload->>'timezone'), ''), timezone),
      updated_at = NOW()
    WHERE id = v_row.id
    RETURNING id INTO v_id;
  END IF;

  SELECT * INTO v_row FROM public.lead_meeting_booking_settings WHERE id = v_id;

  RETURN jsonb_build_object(
    'ok', true,
    'settings', row_to_json(v_row)::JSONB,
    'booking_url_path', '/book/' || v_row.booking_token::TEXT
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_public_booking_config(UUID) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_public_booking_meetings(UUID) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_public_booking_context(UUID) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.staff_get_lead_booking_settings(TEXT, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.staff_upsert_lead_booking_settings(TEXT, TEXT, JSONB) TO authenticated;
