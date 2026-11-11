-- Shared staff calendar: any signed-in user can create, move, or remove an internal meeting.
-- SELECT is already open. UPDATE was limited to the creator, and DELETE had no
-- user policy, so another person's save or delete returned success and changed nothing.
-- The calendar reads start_date_time from this table.
-- Run in the Supabase SQL editor.

DROP POLICY IF EXISTS "Authenticated users can insert shared staff meetings" ON public.outlook_teams_meetings;
DROP POLICY IF EXISTS "Authenticated users can update shared staff meetings" ON public.outlook_teams_meetings;
DROP POLICY IF EXISTS "Authenticated users can delete shared staff meetings" ON public.outlook_teams_meetings;

CREATE POLICY "Authenticated users can insert shared staff meetings"
ON public.outlook_teams_meetings
FOR INSERT
TO authenticated
WITH CHECK (true);

CREATE POLICY "Authenticated users can update shared staff meetings"
ON public.outlook_teams_meetings
FOR UPDATE
TO authenticated
USING (true)
WITH CHECK (true);

CREATE POLICY "Authenticated users can delete shared staff meetings"
ON public.outlook_teams_meetings
FOR DELETE
TO authenticated
USING (true);
