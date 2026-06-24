-- Portal: resolve public booking token for authenticated client session.

CREATE OR REPLACE FUNCTION public.portal_get_booking_access(p_token UUID)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_session public.client_portal_sessions;
  v_row public.lead_meeting_booking_settings;
BEGIN
  v_session := public._portal_session_row(p_token);
  IF v_session IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Invalid session');
  END IF;

  SELECT * INTO v_row
  FROM public.lead_meeting_booking_settings s
  WHERE (v_session.new_lead_id IS NOT NULL AND s.new_lead_id = v_session.new_lead_id)
     OR (v_session.legacy_lead_id IS NOT NULL AND s.legacy_lead_id = v_session.legacy_lead_id)
  LIMIT 1;

  IF v_row IS NULL OR NOT COALESCE(v_row.enabled, FALSE) THEN
    RETURN jsonb_build_object(
      'ok', false,
      'error', 'Self-scheduling is not enabled for your case. Please contact our office.'
    );
  END IF;

  RETURN jsonb_build_object(
    'ok', true,
    'booking_token', v_row.booking_token::TEXT
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.portal_get_booking_access(UUID) TO anon, authenticated;
