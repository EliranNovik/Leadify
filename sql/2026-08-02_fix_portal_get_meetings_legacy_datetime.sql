-- Fix portal_get_meetings for legacy leads:
-- leads_lead.meeting_datetime is TEXT; `AT TIME ZONE` requires timestamp/timestamptz
-- (error: function pg_catalog.timezone(unknown, text) does not exist).

CREATE OR REPLACE FUNCTION public._portal_parse_meeting_datetime(p_value TEXT)
RETURNS TIMESTAMPTZ
LANGUAGE plpgsql
STABLE
AS $$
DECLARE
  v TEXT := NULLIF(TRIM(p_value), '');
BEGIN
  IF v IS NULL THEN
    RETURN NULL;
  END IF;
  BEGIN
    RETURN v::TIMESTAMPTZ;
  EXCEPTION WHEN OTHERS THEN
    BEGIN
      RETURN v::TIMESTAMP AT TIME ZONE 'UTC';
    EXCEPTION WHEN OTHERS THEN
      RETURN NULL;
    END;
  END;
END;
$$;

CREATE OR REPLACE FUNCTION public.portal_get_meetings(p_token UUID)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_session public.client_portal_sessions;
  v_meetings JSONB;
  v_requests JSONB;
BEGIN
  v_session := public._portal_session_row(p_token);
  IF v_session IS NULL THEN
    RETURN NULL;
  END IF;

  SELECT COALESCE(
    jsonb_agg(
      jsonb_build_object(
        'id', r.id,
        'preferred_date', r.preferred_date,
        'preferred_time_range', r.preferred_time_range,
        'notes', r.notes,
        'status', r.status,
        'created_at', r.created_at,
        'updated_at', r.updated_at
      )
      ORDER BY r.created_at DESC
    ),
    '[]'::JSONB
  )
  INTO v_requests
  FROM public.client_portal_meeting_requests r
  WHERE (
    (v_session.new_lead_id IS NOT NULL AND r.new_lead_id = v_session.new_lead_id)
    OR (v_session.legacy_lead_id IS NOT NULL AND r.legacy_lead_id = v_session.legacy_lead_id)
  );

  IF v_session.new_lead_id IS NOT NULL THEN
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
          'created_at', m.created_at
        )
        ORDER BY m.meeting_date DESC NULLS LAST, m.meeting_time DESC NULLS LAST
      ),
      '[]'::JSONB
    )
    INTO v_meetings
    FROM public.meetings m
    WHERE m.client_id = v_session.new_lead_id
      AND (
        m.meeting_date IS NOT NULL
        OR m.meeting_time IS NOT NULL
        OR NULLIF(TRIM(m.teams_meeting_url), '') IS NOT NULL
        OR NULLIF(TRIM(m.custom_link), '') IS NOT NULL
      );
  ELSE
    SELECT COALESCE(
      jsonb_agg(row_data ORDER BY sort_date DESC NULLS LAST, sort_time DESC NULLS LAST),
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
          'created_at', m.created_at
        ) AS row_data,
        m.meeting_date AS sort_date,
        m.meeting_time AS sort_time
      FROM public.meetings m
      WHERE m.legacy_lead_id = v_session.legacy_lead_id
        AND (
          m.meeting_date IS NOT NULL
          OR m.meeting_time IS NOT NULL
          OR NULLIF(TRIM(m.teams_meeting_url), '') IS NOT NULL
          OR NULLIF(TRIM(m.custom_link), '') IS NOT NULL
        )

      UNION ALL

      SELECT
        jsonb_build_object(
          'id', 'legacy_' || ll.id::TEXT,
          'meeting_date', COALESCE(
            NULLIF(TRIM(ll.meeting_date::TEXT), '')::DATE,
            (public._portal_parse_meeting_datetime(ll.meeting_datetime::TEXT) AT TIME ZONE 'UTC')::DATE
          ),
          'meeting_time', COALESCE(
            NULLIF(TRIM(ll.meeting_time::TEXT), ''),
            to_char(
              public._portal_parse_meeting_datetime(ll.meeting_datetime::TEXT) AT TIME ZONE 'UTC',
              'HH24:MI:SS'
            )
          ),
          'meeting_location', COALESCE(
            NULLIF(TRIM(ll.meeting_location_old::TEXT), ''),
            NULLIF(TRIM(ll.meeting_location_id::TEXT), '')
          ),
          'is_physical_meeting', public._portal_is_physical_meeting(
            COALESCE(
              NULLIF(TRIM(ll.meeting_location_old::TEXT), ''),
              NULLIF(TRIM(ll.meeting_location_id::TEXT), '')
            ),
            NULL
          ),
          'meeting_address', public._portal_meeting_address(
            COALESCE(
              NULLIF(TRIM(ll.meeting_location_old::TEXT), ''),
              NULLIF(TRIM(ll.meeting_location_id::TEXT), '')
            ),
            NULL
          ),
          'meeting_subject', NULL,
          'join_url', NULLIF(TRIM(ll.meeting_url), ''),
          'status', 'scheduled',
          'created_at', NULL
        ) AS row_data,
        COALESCE(
          NULLIF(TRIM(ll.meeting_date::TEXT), '')::DATE,
          (public._portal_parse_meeting_datetime(ll.meeting_datetime::TEXT) AT TIME ZONE 'UTC')::DATE
        ) AS sort_date,
        COALESCE(
          NULLIF(TRIM(ll.meeting_time::TEXT), '')::TIME,
          (public._portal_parse_meeting_datetime(ll.meeting_datetime::TEXT) AT TIME ZONE 'UTC')::TIME
        ) AS sort_time
      FROM public.leads_lead ll
      WHERE ll.id = v_session.legacy_lead_id
        AND (
          NULLIF(TRIM(ll.meeting_date::TEXT), '') IS NOT NULL
          OR NULLIF(TRIM(ll.meeting_datetime::TEXT), '') IS NOT NULL
          OR NULLIF(TRIM(ll.meeting_time::TEXT), '') IS NOT NULL
          OR NULLIF(TRIM(ll.meeting_url), '') IS NOT NULL
        )
    ) combined;
  END IF;

  RETURN jsonb_build_object(
    'meetings', COALESCE(v_meetings, '[]'::JSONB),
    'requests', COALESCE(v_requests, '[]'::JSONB)
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public._portal_parse_meeting_datetime(TEXT) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.portal_get_meetings(UUID) TO anon, authenticated;
