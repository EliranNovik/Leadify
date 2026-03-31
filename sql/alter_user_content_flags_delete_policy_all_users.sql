-- =============================================================================
-- Allow ALL authenticated users to delete content flags (shared cleanup).
-- This enables the UI "Delete flag" button to work for flags created by others.
-- Run in Supabase SQL Editor.
-- =============================================================================

ALTER TABLE public.user_content_flags ENABLE ROW LEVEL SECURITY;

-- Replace delete policy: from "own only" → "any authenticated user"
DROP POLICY IF EXISTS "Users can delete own content flags" ON public.user_content_flags;
DROP POLICY IF EXISTS "Authenticated can delete content flags" ON public.user_content_flags;

CREATE POLICY "Authenticated can delete content flags"
  ON public.user_content_flags
  FOR DELETE
  USING (auth.uid() IS NOT NULL);

