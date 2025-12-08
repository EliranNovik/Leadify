-- Add Row-Level Security (RLS) policies for the follow_ups table
-- These policies allow users to manage their own follow-ups

-- Enable RLS on the follow_ups table
ALTER TABLE public.follow_ups ENABLE ROW LEVEL SECURITY;

-- Drop existing policies if they exist (for idempotency)
DROP POLICY IF EXISTS "Users can view their own follow-ups" ON public.follow_ups;
DROP POLICY IF EXISTS "Users can insert their own follow-ups" ON public.follow_ups;
DROP POLICY IF EXISTS "Users can update their own follow-ups" ON public.follow_ups;
DROP POLICY IF EXISTS "Users can delete their own follow-ups" ON public.follow_ups;

-- Policy 1: Users can SELECT (read) their own follow-ups
CREATE POLICY "Users can view their own follow-ups"
ON public.follow_ups
FOR SELECT
USING (
  auth.uid() IN (
    SELECT auth_id 
    FROM public.users 
    WHERE id = follow_ups.user_id
  )
);

-- Policy 2: Users can INSERT (create) their own follow-ups
CREATE POLICY "Users can insert their own follow-ups"
ON public.follow_ups
FOR INSERT
WITH CHECK (
  auth.uid() IN (
    SELECT auth_id 
    FROM public.users 
    WHERE id = follow_ups.user_id
  )
);

-- Policy 3: Users can UPDATE (edit) their own follow-ups
CREATE POLICY "Users can update their own follow-ups"
ON public.follow_ups
FOR UPDATE
USING (
  auth.uid() IN (
    SELECT auth_id 
    FROM public.users 
    WHERE id = follow_ups.user_id
  )
)
WITH CHECK (
  auth.uid() IN (
    SELECT auth_id 
    FROM public.users 
    WHERE id = follow_ups.user_id
  )
);

-- Policy 4: Users can DELETE their own follow-ups
CREATE POLICY "Users can delete their own follow-ups"
ON public.follow_ups
FOR DELETE
USING (
  auth.uid() IN (
    SELECT auth_id 
    FROM public.users 
    WHERE id = follow_ups.user_id
  )
);

-- Optional: If you want to allow superusers to see all follow-ups, uncomment these:
-- DROP POLICY IF EXISTS "Superusers can view all follow-ups" ON public.follow_ups;
-- CREATE POLICY "Superusers can view all follow-ups"
-- ON public.follow_ups
-- FOR SELECT
-- USING (
--   EXISTS (
--     SELECT 1 
--     FROM public.users 
--     WHERE auth_id = auth.uid() 
--     AND is_superuser = true
--   )
-- );

