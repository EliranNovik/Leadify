-- Per main-category booking windows + office closed dates.
-- Run in Supabase SQL editor after meeting_booking_global_settings.sql

ALTER TABLE public.meeting_booking_global_settings
  ADD COLUMN IF NOT EXISTS category_availability_rules JSONB NOT NULL DEFAULT '[]'::JSONB,
  ADD COLUMN IF NOT EXISTS unavailable_dates DATE[] NOT NULL DEFAULT ARRAY[]::DATE[];

COMMENT ON COLUMN public.meeting_booking_global_settings.category_availability_rules IS
  'Array of {main_category_ids, business_hours_start, business_hours_end, days_of_week} — first matching rule wins; fallback is global columns.';
COMMENT ON COLUMN public.meeting_booking_global_settings.unavailable_dates IS
  'Jerusalem calendar dates when booking is closed (holidays, office closure).';

CREATE OR REPLACE FUNCTION public.staff_upsert_meeting_booking_global_settings(p_payload JSONB)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_row public.meeting_booking_global_settings;
  v_unavailable DATE[];
BEGIN
  INSERT INTO public.meeting_booking_global_settings (id) VALUES (1)
  ON CONFLICT (id) DO NOTHING;

  IF p_payload ? 'unavailable_dates' THEN
    SELECT COALESCE(
      ARRAY(
        SELECT DISTINCT (elem::TEXT)::DATE
        FROM jsonb_array_elements_text(p_payload->'unavailable_dates') AS elem
        WHERE elem ~ '^\d{4}-\d{2}-\d{2}$'
      ),
      ARRAY[]::DATE[]
    )
    INTO v_unavailable;
  END IF;

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
    category_availability_rules = CASE WHEN p_payload ? 'category_availability_rules' THEN
      COALESCE(p_payload->'category_availability_rules', '[]'::JSONB)
      ELSE category_availability_rules END,
    unavailable_dates = CASE WHEN p_payload ? 'unavailable_dates' THEN
      COALESCE(v_unavailable, ARRAY[]::DATE[])
      ELSE unavailable_dates END,
    updated_at = NOW()
  WHERE id = 1
  RETURNING * INTO v_row;

  RETURN jsonb_build_object('ok', true, 'settings', row_to_json(v_row)::JSONB);
END;
$$;

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
  v_global public.meeting_booking_global_settings;
  v_lead_number TEXT;
  v_display_name TEXT;
  v_category TEXT;
  v_main_category_id INT;
  v_main_category_name TEXT;
  v_language_id INT;
  v_host_name TEXT;
  v_host_photo TEXT;
  v_unavailable JSONB;
BEGIN
  v_raw := public._booking_settings_by_token(p_token);
  IF v_raw IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Booking link not found or disabled');
  END IF;

  v_settings := public._booking_merged_settings(v_raw);
  SELECT * INTO v_global FROM public.meeting_booking_global_settings WHERE id = 1;

  IF v_settings.legacy_lead_id IS NOT NULL THEN
    SELECT ll.lead_number::TEXT, ll.name, mc.name, mc.parent_id, mmc.name, ll.language_id
    INTO v_lead_number, v_display_name, v_category, v_main_category_id, v_main_category_name, v_language_id
    FROM public.leads_lead ll
    LEFT JOIN public.misc_category mc ON mc.id = ll.category_id
    LEFT JOIN public.misc_maincategory mmc ON mmc.id = mc.parent_id
    WHERE ll.id = v_settings.legacy_lead_id;
  ELSE
    SELECT l.lead_number::TEXT, l.name, mc.name, mc.parent_id, mmc.name, l.language_id
    INTO v_lead_number, v_display_name, v_category, v_main_category_id, v_main_category_name, v_language_id
    FROM public.leads l
    LEFT JOIN public.misc_category mc ON mc.id = l.category_id
    LEFT JOIN public.misc_maincategory mmc ON mmc.id = mc.parent_id
    WHERE l.id = v_settings.new_lead_id;
  END IF;

  IF v_settings.host_employee_id IS NOT NULL THEN
    SELECT te.display_name, te.photo_url
    INTO v_host_name, v_host_photo
    FROM public.tenants_employee te
    WHERE te.id = v_settings.host_employee_id;
  END IF;

  SELECT COALESCE(
    jsonb_agg(to_char(d, 'YYYY-MM-DD') ORDER BY d),
    '[]'::JSONB
  )
  INTO v_unavailable
  FROM unnest(COALESCE(v_global.unavailable_dates, ARRAY[]::DATE[])) AS d;

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
      'send_whatsapp', v_settings.send_whatsapp,
      'category_availability_rules', COALESCE(v_global.category_availability_rules, '[]'::JSONB),
      'unavailable_dates', v_unavailable
    ),
    'lead', jsonb_build_object(
      'lead_number', v_lead_number,
      'lead_ref', v_lead_number,
      'display_name', v_display_name,
      'category', v_category,
      'main_category_id', v_main_category_id,
      'main_category_name', v_main_category_name,
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
  v_global public.meeting_booking_global_settings;
  v_main_category_id INT;
  v_unavailable JSONB;
BEGIN
  v_raw := public._booking_settings_by_token(p_token);
  IF v_raw IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Invalid booking link');
  END IF;

  v_settings := public._booking_merged_settings(v_raw);
  SELECT * INTO v_global FROM public.meeting_booking_global_settings WHERE id = 1;

  IF v_settings.legacy_lead_id IS NOT NULL THEN
    SELECT mc.parent_id INTO v_main_category_id
    FROM public.leads_lead ll
    LEFT JOIN public.misc_category mc ON mc.id = ll.category_id
    WHERE ll.id = v_settings.legacy_lead_id;
  ELSE
    SELECT mc.parent_id INTO v_main_category_id
    FROM public.leads l
    LEFT JOIN public.misc_category mc ON mc.id = l.category_id
    WHERE l.id = v_settings.new_lead_id;
  END IF;

  SELECT COALESCE(
    jsonb_agg(to_char(d, 'YYYY-MM-DD') ORDER BY d),
    '[]'::JSONB
  )
  INTO v_unavailable
  FROM unnest(COALESCE(v_global.unavailable_dates, ARRAY[]::DATE[])) AS d;

  RETURN jsonb_build_object(
    'ok', true,
    'settings', row_to_json(v_settings)::JSONB,
    'main_category_id', v_main_category_id,
    'category_availability_rules', COALESCE(v_global.category_availability_rules, '[]'::JSONB),
    'unavailable_dates', v_unavailable
  );
END;
$$;
