-- Lets a superuser see every RMQ AI quality event in the control center.
-- Staff still only see their own events. Run in the Supabase SQL editor.

DROP POLICY IF EXISTS ai_quality_events_superuser_select ON public.ai_quality_events;
CREATE POLICY ai_quality_events_superuser_select
ON public.ai_quality_events
FOR SELECT
TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.users u
    WHERE u.auth_id = auth.uid()
      AND (u.is_superuser IS TRUE OR u.is_superuser::text IN ('true', 't', '1'))
  )
);
