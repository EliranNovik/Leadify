-- Lets a superuser see every RMQ AI chat for the usage graphs.
-- The graphs count chats, not message text. Run in the Supabase SQL editor.

DROP POLICY IF EXISTS ai_chat_history_superuser_select ON public.ai_chat_history;
CREATE POLICY ai_chat_history_superuser_select
ON public.ai_chat_history
FOR SELECT
TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.users u
    WHERE u.auth_id = auth.uid()
      AND (u.is_superuser IS TRUE OR u.is_superuser::text IN ('true', 't', '1'))
  )
);
