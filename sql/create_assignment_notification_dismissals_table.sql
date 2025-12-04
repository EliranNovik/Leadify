-- Create assignment_notification_dismissals table for storing dismissed assignment notifications
-- This ensures dismissals persist across all browsers for each user

CREATE TABLE IF NOT EXISTS public.assignment_notification_dismissals (
    id BIGSERIAL PRIMARY KEY,
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    dismissal_key TEXT NOT NULL,
    dismissed_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    UNIQUE(user_id, dismissal_key)
);

-- Create index for faster lookups
CREATE INDEX IF NOT EXISTS idx_assignment_dismissals_user_id ON public.assignment_notification_dismissals(user_id);
CREATE INDEX IF NOT EXISTS idx_assignment_dismissals_key ON public.assignment_notification_dismissals(dismissal_key);

-- Enable RLS
ALTER TABLE public.assignment_notification_dismissals ENABLE ROW LEVEL SECURITY;

-- RLS Policies: Users can only manage their own dismissals
CREATE POLICY "Users can view their own dismissals"
  ON public.assignment_notification_dismissals
  FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert their own dismissals"
  ON public.assignment_notification_dismissals
  FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update their own dismissals"
  ON public.assignment_notification_dismissals
  FOR UPDATE
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can delete their own dismissals"
  ON public.assignment_notification_dismissals
  FOR DELETE
  USING (auth.uid() = user_id);

