-- Global meeting booking settings + merged lead settings + links list.
-- Run in Supabase SQL editor after client_booking_page.sql

CREATE TABLE IF NOT EXISTS public.meeting_booking_global_settings (
  id INT PRIMARY KEY DEFAULT 1 CHECK (id = 1),
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
  business_hours_end TIME NOT NULL DEFAULT '21:00',
  days_of_week INT[] NOT NULL DEFAULT ARRAY[0, 1, 2, 3, 4],
  send_email BOOLEAN NOT NULL DEFAULT TRUE,
  send_whatsapp BOOLEAN NOT NULL DEFAULT TRUE,
  send_calendar_invite BOOLEAN NOT NULL DEFAULT TRUE,
  timezone TEXT NOT NULL DEFAULT 'Asia/Jerusalem',
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO public.meeting_booking_global_settings (id)
VALUES (1)
ON CONFLICT (id) DO NOTHING;

ALTER TABLE public.meeting_booking_global_settings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS meeting_booking_global_staff_all ON public.meeting_booking_global_settings;
CREATE POLICY meeting_booking_global_staff_all
  ON public.meeting_booking_global_settings
  FOR ALL
  TO authenticated
  USING (TRUE)
  WITH CHECK (TRUE);

-- Merge per-lead row with global defaults (global wins for all config fields).
CREATE OR REPLACE FUNCTION public._booking_merged_settings(p_lead public.lead_meeting_booking_settings)
RETURNS public.lead_meeting_booking_settings
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    p_lead.id,
    p_lead.booking_token,
    p_lead.new_lead_id,
    p_lead.legacy_lead_id,
    p_lead.enabled,
    g.title,
    g.description,
    g.duration_minutes,
    g.meeting_location,
    g.meeting_location_id,
    g.host_employee_id,
    g.meeting_manager,
    g.calendar_type,
    g.buffer_minutes,
    g.min_notice_hours,
    g.max_days_ahead,
    g.slot_interval_minutes,
    g.business_hours_start,
    g.business_hours_end,
    g.days_of_week,
    g.send_email,
    g.send_whatsapp,
    g.send_calendar_invite,
    g.timezone,
    p_lead.created_by_user_id,
    p_lead.created_at,
    p_lead.updated_at
  FROM public.meeting_booking_global_settings g
  WHERE g.id = 1;
$$;

CREATE OR REPLACE FUNCTION public.staff_get_meeting_booking_global_settings()
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_row public.meeting_booking_global_settings;
BEGIN
  SELECT * INTO v_row FROM public.meeting_booking_global_settings WHERE id = 1;
  IF v_row IS NULL THEN
    INSERT INTO public.meeting_booking_global_settings (id) VALUES (1)
    RETURNING * INTO v_row;
  END IF;

  RETURN jsonb_build_object('ok', true, 'settings', row_to_json(v_row)::JSONB);
END;
$$;

CREATE OR REPLACE FUNCTION public.staff_upsert_meeting_booking_global_settings(p_payload JSONB)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_row public.meeting_booking_global_settings;
BEGIN
  INSERT INTO public.meeting_booking_global_settings (id) VALUES (1)
  ON CONFLICT (id) DO NOTHING;

  UPDATE public.meeting_booking_global_settings
  SET
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
  WHERE id = 1
  RETURNING * INTO v_row;

  RETURN jsonb_build_object('ok', true, 'settings', row_to_json(v_row)::JSONB);
END;
$$;

CREATE OR REPLACE FUNCTION public.staff_list_meeting_booking_links()
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_links JSONB;
BEGIN
  SELECT COALESCE(
    jsonb_agg(
      jsonb_build_object(
        'id', s.id,
        'booking_token', s.booking_token::TEXT,
        'enabled', s.enabled,
        'lead_number', COALESCE(l.lead_number::TEXT, ll.lead_number::TEXT),
        'lead_name', COALESCE(l.name, ll.name),
        'lead_type', CASE WHEN s.legacy_lead_id IS NOT NULL THEN 'legacy' ELSE 'new' END,
        'lead_id', COALESCE(s.new_lead_id::TEXT, s.legacy_lead_id::TEXT),
        'created_at', s.created_at,
        'updated_at', s.updated_at,
        'booking_url_path', '/book/' || s.booking_token::TEXT
      )
      ORDER BY s.updated_at DESC NULLS LAST, s.id DESC
    ),
    '[]'::JSONB
  )
  INTO v_links
  FROM public.lead_meeting_booking_settings s
  LEFT JOIN public.leads l ON l.id = s.new_lead_id
  LEFT JOIN public.leads_lead ll ON ll.id = s.legacy_lead_id;

  RETURN jsonb_build_object('ok', true, 'links', v_links);
END;
$$;

-- Public config uses merged (global) settings
CREATE OR REPLACE FUNCTION public.get_public_booking_config(p_token UUID)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_raw public.lead_meeting_booking_settings;
  v_settings public.lead_meeting_booking_settings;
  v_lead_number TEXT;
  v_display_name TEXT;
  v_category TEXT;
  v_language_id INT;
  v_host_name TEXT;
  v_host_photo TEXT;
BEGIN
  v_raw := public._booking_settings_by_token(p_token);
  IF v_raw IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Booking link not found or disabled');
  END IF;

  v_settings := public._booking_merged_settings(v_raw);

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

CREATE OR REPLACE FUNCTION public.get_public_booking_context(p_token UUID)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_raw public.lead_meeting_booking_settings;
  v_settings public.lead_meeting_booking_settings;
BEGIN
  v_raw := public._booking_settings_by_token(p_token);
  IF v_raw IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Invalid booking link');
  END IF;

  v_settings := public._booking_merged_settings(v_raw);

  RETURN jsonb_build_object(
    'ok', true,
    'settings', row_to_json(v_settings)::JSONB
  );
END;
$$;

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
  v_merged public.lead_meeting_booking_settings;
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

  v_merged := public._booking_merged_settings(v_row);

  RETURN jsonb_build_object(
    'ok', true,
    'settings', row_to_json(v_merged)::JSONB,
    'booking_url_path', '/book/' || v_row.booking_token::TEXT
  );
END;
$$;

-- Per-lead: only enabled + generate_link (copies global defaults on create).
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
  v_global public.meeting_booking_global_settings;
  v_merged public.lead_meeting_booking_settings;
  v_id BIGINT;
  v_generate BOOLEAN := COALESCE((p_payload->>'generate_link')::BOOLEAN, FALSE);
  v_enabled BOOLEAN := COALESCE((p_payload->>'enabled')::BOOLEAN, FALSE);
BEGIN
  IF lower(coalesce(p_lead_type, '')) = 'legacy' OR p_lead_id ~ '^legacy_' OR p_lead_id ~ '^\d+$' THEN
    v_legacy_lead_id := CASE
      WHEN p_lead_id ~ '^legacy_' THEN NULLIF(regexp_replace(p_lead_id, '^legacy_', ''), '')::BIGINT
      ELSE p_lead_id::BIGINT
    END;
  ELSE
    v_new_lead_id := p_lead_id::UUID;
  END IF;

  SELECT * INTO v_global FROM public.meeting_booking_global_settings WHERE id = 1;
  IF v_global IS NULL THEN
    INSERT INTO public.meeting_booking_global_settings (id) VALUES (1)
    RETURNING * INTO v_global;
  END IF;

  SELECT * INTO v_row
  FROM public.lead_meeting_booking_settings s
  WHERE (v_new_lead_id IS NOT NULL AND s.new_lead_id = v_new_lead_id)
     OR (v_legacy_lead_id IS NOT NULL AND s.legacy_lead_id = v_legacy_lead_id)
  LIMIT 1;

  IF v_row IS NULL THEN
    IF NOT v_generate AND NOT (p_payload ? 'enabled') THEN
      RETURN jsonb_build_object('ok', true, 'settings', NULL);
    END IF;

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
      CASE WHEN v_generate THEN TRUE ELSE v_enabled END,
      v_global.title,
      v_global.description,
      v_global.duration_minutes,
      v_global.meeting_location,
      v_global.meeting_location_id,
      v_global.host_employee_id,
      v_global.meeting_manager,
      v_global.calendar_type,
      v_global.buffer_minutes,
      v_global.min_notice_hours,
      v_global.max_days_ahead,
      v_global.slot_interval_minutes,
      v_global.business_hours_start,
      v_global.business_hours_end,
      v_global.days_of_week,
      v_global.send_email,
      v_global.send_whatsapp,
      v_global.send_calendar_invite,
      v_global.timezone
    )
    RETURNING id INTO v_id;
  ELSE
    UPDATE public.lead_meeting_booking_settings
    SET
      enabled = CASE
        WHEN v_generate THEN TRUE
        WHEN p_payload ? 'enabled' THEN v_enabled
        ELSE enabled
      END,
      updated_at = NOW()
    WHERE id = v_row.id
    RETURNING id INTO v_id;
  END IF;

  SELECT * INTO v_row FROM public.lead_meeting_booking_settings WHERE id = v_id;
  v_merged := public._booking_merged_settings(v_row);

  RETURN jsonb_build_object(
    'ok', true,
    'settings', row_to_json(v_merged)::JSONB,
    'booking_url_path', '/book/' || v_row.booking_token::TEXT
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.staff_get_meeting_booking_global_settings() TO authenticated;
GRANT EXECUTE ON FUNCTION public.staff_upsert_meeting_booking_global_settings(JSONB) TO authenticated;
GRANT EXECUTE ON FUNCTION public.staff_list_meeting_booking_links() TO authenticated;
