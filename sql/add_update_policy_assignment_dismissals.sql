-- Add UPDATE policy for assignment_notification_dismissals table
-- This is needed for upsert operations

-- Drop the policy if it already exists (to avoid errors on re-run)
DROP POLICY IF EXISTS "Users can update their own dismissals" ON public.assignment_notification_dismissals;

-- Create the UPDATE policy
CREATE POLICY "Users can update their own dismissals"
  ON public.assignment_notification_dismissals
  FOR UPDATE
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

