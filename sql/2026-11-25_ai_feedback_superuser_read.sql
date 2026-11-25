-- Lets a superuser see every thumbs up and thumbs down in the RMQ AI control center.
-- Staff still only see their own ratings. Run in the Supabase SQL editor.

DROP POLICY IF EXISTS ai_feedback_superuser_select ON public.ai_feedback;
CREATE POLICY ai_feedback_superuser_select
ON public.ai_feedback
FOR SELECT
TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.users u
    WHERE u.auth_id = auth.uid()
      AND (u.is_superuser IS TRUE OR u.is_superuser::text IN ('true', 't', '1'))
  )
);
