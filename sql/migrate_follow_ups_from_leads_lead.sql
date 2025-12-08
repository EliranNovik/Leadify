-- Migration script to move follow-ups from leads_lead.next_followup to follow_ups table
-- This creates individual follow-up records for Manager, Scheduler, and Closer roles
-- for each lead that has a next_followup value

-- Helper function to parse next_followup text to timestamp
-- This function tries multiple date formats and returns NULL if parsing fails
CREATE OR REPLACE FUNCTION parse_followup_date(date_text TEXT)
RETURNS TIMESTAMP WITH TIME ZONE AS $$
DECLARE
    parsed_date TIMESTAMP WITH TIME ZONE;
BEGIN
    -- Return NULL if input is empty or null
    IF date_text IS NULL OR TRIM(date_text) = '' THEN
        RETURN NULL;
    END IF;
    
    -- Try ISO format: YYYY-MM-DD or YYYY-MM-DD HH:MM:SS
    IF date_text ~ '^\d{4}-\d{2}-\d{2}' THEN
        BEGIN
            IF date_text ~ '^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}' THEN
                parsed_date := date_text::TIMESTAMP WITH TIME ZONE;
            ELSE
                parsed_date := (date_text || ' 00:00:00')::TIMESTAMP WITH TIME ZONE;
            END IF;
            RETURN parsed_date;
        EXCEPTION WHEN OTHERS THEN
            NULL; -- Continue to next format
        END;
    END IF;
    
    -- Try DD/MM/YYYY format
    BEGIN
        parsed_date := TO_TIMESTAMP(date_text, 'DD/MM/YYYY');
        RETURN parsed_date;
    EXCEPTION WHEN OTHERS THEN
        NULL; -- Continue to next format
    END;
    
    -- Try DD-MM-YYYY format
    BEGIN
        parsed_date := TO_TIMESTAMP(date_text, 'DD-MM-YYYY');
        RETURN parsed_date;
    EXCEPTION WHEN OTHERS THEN
        NULL; -- Continue to next format
    END;
    
    -- Try MM/DD/YYYY format
    BEGIN
        parsed_date := TO_TIMESTAMP(date_text, 'MM/DD/YYYY');
        RETURN parsed_date;
    EXCEPTION WHEN OTHERS THEN
        NULL; -- Continue to next format
    END;
    
    -- Last resort: try direct casting
    BEGIN
        parsed_date := date_text::TIMESTAMP WITH TIME ZONE;
        RETURN parsed_date;
    EXCEPTION WHEN OTHERS THEN
        RETURN NULL; -- Return NULL if all parsing attempts fail
    END;
END;
$$ LANGUAGE plpgsql IMMUTABLE;

-- Step 1: Insert follow-ups for Managers
INSERT INTO public.follow_ups (lead_id, new_lead_id, user_id, date, created_at)
SELECT DISTINCT
    ll.id as lead_id,
    NULL::uuid as new_lead_id,
    u.id as user_id,
    parse_followup_date(ll.next_followup) as date,
    NOW() as created_at
FROM public.leads_lead ll
INNER JOIN public.users u ON u.employee_id = ll.meeting_manager_id
WHERE 
    ll.next_followup IS NOT NULL 
    AND ll.next_followup != ''
    AND ll.meeting_manager_id IS NOT NULL
    AND u.id IS NOT NULL
    AND parse_followup_date(ll.next_followup) IS NOT NULL
    -- Avoid duplicates: only insert if this combination doesn't already exist
    AND NOT EXISTS (
        SELECT 1 
        FROM public.follow_ups fu 
        WHERE fu.lead_id = ll.id 
        AND fu.user_id = u.id
        AND fu.date = parse_followup_date(ll.next_followup)
    );

-- Step 2: Insert follow-ups for Schedulers
INSERT INTO public.follow_ups (lead_id, new_lead_id, user_id, date, created_at)
SELECT DISTINCT
    ll.id as lead_id,
    NULL::uuid as new_lead_id,
    u.id as user_id,
    parse_followup_date(ll.next_followup) as date,
    NOW() as created_at
FROM public.leads_lead ll
INNER JOIN public.users u ON u.employee_id = ll.meeting_scheduler_id
WHERE 
    ll.next_followup IS NOT NULL 
    AND ll.next_followup != ''
    AND ll.meeting_scheduler_id IS NOT NULL
    AND u.id IS NOT NULL
    AND parse_followup_date(ll.next_followup) IS NOT NULL
    -- Avoid duplicates
    AND NOT EXISTS (
        SELECT 1 
        FROM public.follow_ups fu 
        WHERE fu.lead_id = ll.id 
        AND fu.user_id = u.id
        AND fu.date = parse_followup_date(ll.next_followup)
    );

-- Step 3: Insert follow-ups for Closers
INSERT INTO public.follow_ups (lead_id, new_lead_id, user_id, date, created_at)
SELECT DISTINCT
    ll.id as lead_id,
    NULL::uuid as new_lead_id,
    u.id as user_id,
    parse_followup_date(ll.next_followup) as date,
    NOW() as created_at
FROM public.leads_lead ll
INNER JOIN public.users u ON u.employee_id = ll.closer_id
WHERE 
    ll.next_followup IS NOT NULL 
    AND ll.next_followup != ''
    AND ll.closer_id IS NOT NULL
    AND u.id IS NOT NULL
    AND parse_followup_date(ll.next_followup) IS NOT NULL
    -- Avoid duplicates
    AND NOT EXISTS (
        SELECT 1 
        FROM public.follow_ups fu 
        WHERE fu.lead_id = ll.id 
        AND fu.user_id = u.id
        AND fu.date = parse_followup_date(ll.next_followup)
    );

-- Summary query to verify the migration
SELECT 
    'Migration Summary' as description,
    COUNT(*) as total_follow_ups_created,
    COUNT(DISTINCT lead_id) as unique_leads_with_follow_ups,
    COUNT(DISTINCT user_id) as unique_users_with_follow_ups
FROM public.follow_ups
WHERE lead_id IS NOT NULL;

-- Show breakdown by user
SELECT 
    'Follow-ups by User' as description,
    u.email,
    u.first_name,
    u.last_name,
    COUNT(*) as follow_up_count
FROM public.follow_ups fu
INNER JOIN public.users u ON u.id = fu.user_id
WHERE fu.lead_id IS NOT NULL
GROUP BY u.id, u.email, u.first_name, u.last_name
ORDER BY follow_up_count DESC
LIMIT 20;

-- Optional: Drop the helper function after migration (uncomment if desired)
-- DROP FUNCTION IF EXISTS parse_followup_date(TEXT);

