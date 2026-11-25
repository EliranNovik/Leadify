-- Rules, behaviour, and service text for the RMQ AI chat.
-- Active rows are added to the system prompt on every reply.
-- Run in the Supabase SQL editor. Safe to run more than once.

CREATE TABLE IF NOT EXISTS public.ai_chat_guides (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  category text NOT NULL CHECK (category IN ('rule', 'behavior', 'service')),
  title text NOT NULL,
  body text NOT NULL,
  is_active boolean NOT NULL DEFAULT true,
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.ai_chat_guides IS
  'Admin text the RMQ AI chat must follow. rule, behavior, and service rows are injected into the system prompt while active.';

ALTER TABLE public.ai_chat_guides ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS ai_chat_guides_select ON public.ai_chat_guides;
CREATE POLICY ai_chat_guides_select
ON public.ai_chat_guides
FOR SELECT
TO authenticated
USING (true);

DROP POLICY IF EXISTS ai_chat_guides_insert ON public.ai_chat_guides;
CREATE POLICY ai_chat_guides_insert
ON public.ai_chat_guides
FOR INSERT
TO authenticated
WITH CHECK (
  EXISTS (
    SELECT 1 FROM public.users u
    WHERE u.auth_id = auth.uid()
      AND (u.is_superuser IS TRUE OR u.is_superuser::text IN ('true', 't', '1'))
  )
);

DROP POLICY IF EXISTS ai_chat_guides_update ON public.ai_chat_guides;
CREATE POLICY ai_chat_guides_update
ON public.ai_chat_guides
FOR UPDATE
TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.users u
    WHERE u.auth_id = auth.uid()
      AND (u.is_superuser IS TRUE OR u.is_superuser::text IN ('true', 't', '1'))
  )
)
WITH CHECK (
  EXISTS (
    SELECT 1 FROM public.users u
    WHERE u.auth_id = auth.uid()
      AND (u.is_superuser IS TRUE OR u.is_superuser::text IN ('true', 't', '1'))
  )
);

DROP POLICY IF EXISTS ai_chat_guides_delete ON public.ai_chat_guides;
CREATE POLICY ai_chat_guides_delete
ON public.ai_chat_guides
FOR DELETE
TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.users u
    WHERE u.auth_id = auth.uid()
      AND (u.is_superuser IS TRUE OR u.is_superuser::text IN ('true', 't', '1'))
  )
);
