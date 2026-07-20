-- =============================================================================
-- Allow authenticated users to SELECT all content flags (team / pipeline reports).
-- Insert/update stay own-only; delete already allows all authenticated.
-- Run in Supabase SQL Editor.
-- =============================================================================

ALTER TABLE public.user_content_flags ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view own content flags" ON public.user_content_flags;
DROP POLICY IF EXISTS "Authenticated can view content flags" ON public.user_content_flags;

CREATE POLICY "Authenticated can view content flags"
  ON public.user_content_flags
  FOR SELECT
  USING (auth.uid() IS NOT NULL);

COMMENT ON POLICY "Authenticated can view content flags" ON public.user_content_flags IS
  'Team-wide read so Client page, Super Pipeline, and reports show flags from all users.';
