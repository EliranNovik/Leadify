-- Add automatic cleanup trigger for assignment_notification_dismissals table
-- This automatically keeps only the most recent 500 dismissals per user to prevent table overflow
-- The cleanup runs automatically after each insert via database trigger
-- Note: Deleting old dismissals means those notifications could reappear if the same
-- assignment happens again. However, since dismissal keys include timestamps, reassignments
-- typically have new timestamps and would be treated as new notifications anyway.

-- Create a trigger function that runs cleanup automatically after inserts
-- This ensures the table never exceeds 500 dismissals per user
CREATE OR REPLACE FUNCTION trigger_cleanup_assignment_dismissals()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    dismissal_count INTEGER;
BEGIN
    -- Count dismissals for this user
    SELECT COUNT(*) INTO dismissal_count
    FROM public.assignment_notification_dismissals
    WHERE user_id = NEW.user_id;
    
    -- If user has more than 500 dismissals, delete the oldest ones
    -- Keep only the most recent 500 dismissals
    IF dismissal_count > 500 THEN
        DELETE FROM public.assignment_notification_dismissals
        WHERE user_id = NEW.user_id
        AND id NOT IN (
            SELECT id
            FROM public.assignment_notification_dismissals
            WHERE user_id = NEW.user_id
            ORDER BY dismissed_at DESC
            LIMIT 500
        );
    END IF;
    
    RETURN NEW;
END;
$$;

-- Create trigger that automatically runs cleanup after each insert
-- This ensures cleanup happens automatically in the database without any manual intervention
DROP TRIGGER IF EXISTS cleanup_assignment_dismissals_trigger ON public.assignment_notification_dismissals;
CREATE TRIGGER cleanup_assignment_dismissals_trigger
    AFTER INSERT ON public.assignment_notification_dismissals
    FOR EACH ROW
    EXECUTE FUNCTION trigger_cleanup_assignment_dismissals();

