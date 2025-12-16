-- Add comment columns to user_highlights table
ALTER TABLE public.user_highlights 
ADD COLUMN IF NOT EXISTS comment text null,
ADD COLUMN IF NOT EXISTS comment_updated_at timestamp with time zone null;

-- Add comment for documentation
COMMENT ON COLUMN public.user_highlights.comment IS 'User comment for this highlight';
COMMENT ON COLUMN public.user_highlights.comment_updated_at IS 'Timestamp when the comment was last updated';

-- Add UPDATE policy if it doesn't exist (for updating comments)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies 
    WHERE schemaname = 'public' 
    AND tablename = 'user_highlights' 
    AND policyname = 'Users can update their own highlights'
  ) THEN
    CREATE POLICY "Users can update their own highlights"
      ON public.user_highlights
      FOR UPDATE
      USING (auth.uid() IN (SELECT auth_id FROM users WHERE id = user_highlights.user_id))
      WITH CHECK (auth.uid() IN (SELECT auth_id FROM users WHERE id = user_highlights.user_id));
  END IF;
END $$;

