-- WhatsApp INSERT was rolling back (57014) because AFTER INSERT triggers call
-- evaluate_and_update_stage, which COUNT(*)s emails for the lead.
--
-- Do NOT DROP/CREATE TRIGGER on whatsapp_messages — that takes AccessExclusiveLock
-- and deadlocks against live inbound inserts. Replace the existing trigger
-- functions in place instead (emails keep stage eval).

SET lock_timeout = '5s';
SET deadlock_timeout = '1s';

-- Row trigger on whatsapp_messages: collect nothing.
CREATE OR REPLACE FUNCTION public.trigger_stage_evaluation_on_whatsapp()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RETURN NEW;
END;
$$;

-- Statement trigger is shared with emails. Skip only WhatsApp writes.
CREATE OR REPLACE FUNCTION public.trigger_process_evaluations_statement()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_TABLE_NAME = 'whatsapp_messages' THEN
    RETURN NULL;
  END IF;
  PERFORM public.process_pending_stage_evaluations();
  RETURN NULL;
END;
$$;

-- Fast insert used by inbound webhook + send API. Skip remaining AFTER INSERT hooks.
CREATE OR REPLACE FUNCTION public.insert_whatsapp_message(p_row jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
SET statement_timeout = '6s'
AS $$
DECLARE
  v_id bigint;
  v_template_id bigint;
  v_wa_id text;
BEGIN
  BEGIN
    PERFORM set_config('session_replication_role', 'replica', true);
  EXCEPTION WHEN OTHERS THEN
    NULL;
  END;

  INSERT INTO public.whatsapp_messages (
    lead_id,
    legacy_id,
    contact_id,
    phone_number,
    sender_id,
    sender_name,
    direction,
    message,
    template_id,
    sent_at,
    whatsapp_message_id,
    whatsapp_status,
    message_type,
    whatsapp_timestamp,
    media_url,
    media_id,
    media_filename,
    media_mime_type,
    media_size,
    caption,
    voice_note,
    profile_picture_url
  ) VALUES (
    NULLIF(p_row->>'lead_id', '')::uuid,
    NULLIF(p_row->>'legacy_id', '')::bigint,
    NULLIF(p_row->>'contact_id', '')::bigint,
    p_row->>'phone_number',
    NULLIF(p_row->>'sender_id', '')::uuid,
    p_row->>'sender_name',
    COALESCE(NULLIF(p_row->>'direction', ''), 'out'),
    COALESCE(p_row->>'message', ''),
    NULLIF(p_row->>'template_id', '')::bigint,
    COALESCE(NULLIF(p_row->>'sent_at', '')::timestamptz, now()),
    p_row->>'whatsapp_message_id',
    COALESCE(NULLIF(p_row->>'whatsapp_status', ''), 'pending'),
    COALESCE(NULLIF(p_row->>'message_type', ''), 'text'),
    COALESCE(NULLIF(p_row->>'whatsapp_timestamp', '')::timestamptz, now()),
    NULLIF(p_row->>'media_url', ''),
    NULLIF(p_row->>'media_id', ''),
    NULLIF(p_row->>'media_filename', ''),
    NULLIF(p_row->>'media_mime_type', ''),
    NULLIF(p_row->>'media_size', '')::integer,
    NULLIF(p_row->>'caption', ''),
    COALESCE(NULLIF(p_row->>'voice_note', '')::boolean, false),
    NULLIF(p_row->>'profile_picture_url', '')
  )
  RETURNING id, template_id, whatsapp_message_id
  INTO v_id, v_template_id, v_wa_id;

  RETURN jsonb_build_object(
    'id', v_id,
    'template_id', v_template_id,
    'whatsapp_message_id', v_wa_id
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.insert_whatsapp_outgoing(p_row jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
SET statement_timeout = '6s'
AS $$
BEGIN
  RETURN public.insert_whatsapp_message(p_row);
END;
$$;

GRANT EXECUTE ON FUNCTION public.insert_whatsapp_message(jsonb)
  TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.insert_whatsapp_outgoing(jsonb)
  TO anon, authenticated, service_role;

NOTIFY pgrst, 'reload schema';
