-- Scheduled meetings on public booking page + portal lead ref in config.
-- Run in Supabase SQL editor.

CREATE OR REPLACE FUNCTION public._portal_known_booking_address(p_meeting_location TEXT)
RETURNS TEXT
LANGUAGE sql
STABLE
AS $$
  SELECT CASE lower(trim(COALESCE(p_meeting_location, '')))
    WHEN 'ramat gan office' THEN 'Menachem Begin Rd. 11, Ramat Gan, Israel'
    ELSE NULL
  END;
$$;

CREATE OR REPLACE FUNCTION public._portal_is_physical_meeting(
  p_meeting_location TEXT,
  p_manual_address TEXT DEFAULT NULL
)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
AS $$
  SELECT
    COALESCE(
      (
        SELECT COALESCE(tml.is_physical_location, false)
        FROM public.tenants_meetinglocation tml
        WHERE lower(trim(tml.name)) = lower(trim(COALESCE(p_meeting_location, '')))
        ORDER BY tml.id
        LIMIT 1
      ),
      false
    )
    OR NULLIF(trim(COALESCE(p_manual_address, '')), '') IS NOT NULL
    OR public._portal_known_booking_address(p_meeting_location) IS NOT NULL;
$$;

CREATE OR REPLACE FUNCTION public._portal_meeting_address(
  p_meeting_location TEXT,
  p_manual_address TEXT DEFAULT NULL
)
RETURNS TEXT
LANGUAGE sql
STABLE
AS $$
  SELECT CASE
    WHEN public._portal_is_physical_meeting(p_meeting_location, p_manual_address) THEN
      NULLIF(trim(COALESCE(
        NULLIF(trim(COALESCE(p_manual_address, '')), ''),
        (
          SELECT NULLIF(trim(COALESCE(tml.address, '')), '')
          FROM public.tenants_meetinglocation tml
          WHERE lower(trim(tml.name)) = lower(trim(COALESCE(p_meeting_location, '')))
          ORDER BY tml.id
          LIMIT 1
        ),
        public._portal_known_booking_address(p_meeting_location)
      )), '')
    ELSE NULL
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
          'is_physical_meeting', public._portal_is_physical_meeting(m.meeting_location, m.manual_address),
          'meeting_address', public._portal_meeting_address(m.meeting_location, m.manual_address),
          'meeting_subject', NULLIF(TRIM(m.meeting_subject), ''),
          'join_url', NULLIF(
            COALESCE(NULLIF(TRIM(m.custom_link), ''), NULLIF(TRIM(m.teams_meeting_url), '')),
            ''
          ),
          'status', COALESCE(NULLIF(TRIM(m.status), ''), 'scheduled'),
          'booked_via_client_link', COALESCE(m.scheduler, '') = 'Client booking',
          'client_booking_timezone', NULLIF(TRIM(m.client_booking_timezone), ''),
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
          'is_physical_meeting', public._portal_is_physical_meeting(m.meeting_location, m.manual_address),
          'meeting_address', public._portal_meeting_address(m.meeting_location, m.manual_address),
          'meeting_subject', NULLIF(TRIM(m.meeting_subject), ''),
          'join_url', NULLIF(
            COALESCE(NULLIF(TRIM(m.custom_link), ''), NULLIF(TRIM(m.teams_meeting_url), '')),
            ''
          ),
          'status', COALESCE(NULLIF(TRIM(m.status), ''), 'scheduled'),
          'booked_via_client_link', COALESCE(m.scheduler, '') = 'Client booking',
          'client_booking_timezone', NULLIF(TRIM(m.client_booking_timezone), ''),
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

GRANT EXECUTE ON FUNCTION public.get_public_booking_meetings(UUID) TO anon, authenticated, service_role;
