-- Lets a superuser read every employee's saved RMQ AI memories.
-- Staff still only see their own rows. Run in the Supabase SQL editor.

DROP POLICY IF EXISTS ai_user_memory_superuser_select ON public.ai_user_memory;
CREATE POLICY ai_user_memory_superuser_select
ON public.ai_user_memory
FOR SELECT
TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.users u
    WHERE u.auth_id = auth.uid()
      AND (u.is_superuser IS TRUE OR u.is_superuser::text IN ('true', 't', '1'))
  )
);
