-- Batch unread counts for RMQ sidebar (replaces N+1 per-conversation queries).
-- Run in Supabase SQL editor or via migration.

CREATE OR REPLACE FUNCTION public.rmq_unread_counts_for_user()
RETURNS TABLE(conversation_id bigint, unread_count integer)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT m.conversation_id::bigint,
         COUNT(*)::integer AS unread_count
  FROM public.messages m
  INNER JOIN public.conversation_participants cp
    ON cp.conversation_id = m.conversation_id
    AND cp.user_id = (SELECT u.id FROM public.users u WHERE u.auth_id = auth.uid() LIMIT 1)
    AND cp.is_active = true
  WHERE m.is_deleted = false
    AND m.sent_at > cp.last_read_at
    AND m.sender_id <> cp.user_id
  GROUP BY m.conversation_id;
$$;

REVOKE ALL ON FUNCTION public.rmq_unread_counts_for_user() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.rmq_unread_counts_for_user() TO authenticated;
GRANT EXECUTE ON FUNCTION public.rmq_unread_counts_for_user() TO service_role;

COMMENT ON FUNCTION public.rmq_unread_counts_for_user() IS 'Returns unread message counts per conversation for the current auth user (RMQ).';
