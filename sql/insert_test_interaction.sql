-- Insert a new test interaction for lead ID 89803
-- This will help test the legacy interactions functionality

INSERT INTO public.leads_leadinteractions (
    id,
    cdate,
    udate,
    kind,
    date,
    time,
    minutes,
    content,
    creator_id,
    lead_id,
    direction,
    link,
    read,
    wa_num_id,
    employee_id,
    description
) VALUES (
    (SELECT COALESCE(MAX(id), 0) + 1 FROM public.leads_leadinteractions), -- Auto-increment ID
    NOW(), -- cdate (current timestamp)
    NOW(), -- udate (current timestamp)
    'c', -- kind: 'c' for call, 'e' for email, 'EMPTY' for note
    TO_CHAR(NOW(), 'YYYY-MM-DD'), -- date in YYYY-MM-DD format
    TO_CHAR(NOW(), 'HH24:MI:SS'), -- time in HH:MM:SS format
    5, -- minutes (call duration)
    'Test call with client - discussed project requirements', -- content
    '2', -- creator_id (employee who created the interaction)
    89803, -- lead_id (the legacy lead ID)
    'o', -- direction: 'o' for outgoing, 'i' for incoming
    '\N', -- link (null value)
    'f', -- read: 'f' for unread, 't' for read
    '\N', -- wa_num_id (null value)
    '2', -- employee_id (employee who made the call)
    'Client was interested in our services' -- description
);

-- Verify the insert
SELECT 
    id,
    cdate,
    kind,
    date,
    time,
    minutes,
    content,
    creator_id,
    lead_id,
    direction,
    read,
    employee_id,
    description
FROM public.leads_leadinteractions 
WHERE lead_id = 89803 
ORDER BY cdate DESC 
LIMIT 5;
