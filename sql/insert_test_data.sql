-- First, insert test leads
INSERT INTO leads (
    lead_number,
    name,
    status,
    topic,
    email,
    source,
    helper,
    expert,
    probability,
    language,
    desired_location,
    facts,
    special_notes,
    general_notes,
    potential_metrics,
    tags,
    anchor
)
VALUES 
    (
        'L122325',
        'Mark Ehrlich',
        'New Lead',
        'German Citizenship',
        'mark.e@example.com',
        'Website',
        'Mindi',
        'David K',
        50,
        'German',
        'Berlin',
        'Client has German ancestry through grandmother who left Germany in 1939.',
        'Priority case - grandmother documents available',
        'Initial contact made through website inquiry',
        '[{"label": "Legal", "value": "High", "progress": 80, "color": "success"}, {"label": "Revenue", "value": "10-15k", "progress": 70, "color": "warning"}]',
        'German Citizenship, Article 116',
        'Grandmother emigrated in 1939'
    ),
    (
        'L122326',
        'Jane Granek',
        'Hot Lead',
        'German Citizenship',
        'jane.g@example.com',
        'Referral',
        'Mindi',
        'David K',
        75,
        'English',
        'Munich',
        'Family history traced back to Frankfurt. Great-grandfather was a German citizen.',
        'Has original passport from 1932',
        'Referred by existing client Mark',
        '[{"label": "Legal", "value": "Medium", "progress": 60, "color": "info"}, {"label": "Revenue", "value": "5-10k", "progress": 50, "color": "warning"}]',
        'German Citizenship, Documentation Complete',
        'Great-grandfather connection'
    ),
    (
        'L122327',
        'Ida Bloch',
        'Follow Up',
        'Proposal Discussion',
        'ida.b@example.com',
        'Direct',
        'Mindi',
        'David K',
        90,
        'Hebrew',
        'Hamburg',
        'Direct descendant of German citizens who fled in 1938. Has extensive documentation.',
        'All documents verified',
        'Ready for submission',
        '[{"label": "Legal", "value": "Very High", "progress": 90, "color": "success"}, {"label": "Revenue", "value": "15-20k", "progress": 85, "color": "success"}]',
        'German Citizenship, Ready for Submission',
        'Direct descendant 1938'
    )
ON CONFLICT (lead_number) DO NOTHING
RETURNING id;

-- Then, insert meetings for today and tomorrow
WITH lead_ids AS (
    SELECT id, lead_number 
    FROM leads 
    WHERE lead_number IN ('L122325', 'L122326', 'L122327')
)
INSERT INTO meetings (
    client_id,
    meeting_date,
    meeting_time,
    meeting_location,
    meeting_manager,
    meeting_currency,
    meeting_amount,
    expert,
    helper,
    teams_meeting_url,
    meeting_brief,
    scheduler,
    status
)
SELECT
    l.id,
    -- Use current_date for today's meetings and current_date + 1 for tomorrow's
    CASE 
        WHEN l.lead_number IN ('L122325', 'L122326') THEN CURRENT_DATE
        ELSE CURRENT_DATE + 1
    END as meeting_date,
    -- Different times for each meeting
    CASE l.lead_number
        WHEN 'L122325' THEN '10:00'::TIME
        WHEN 'L122326' THEN '14:30'::TIME
        ELSE '11:00'::TIME
    END as meeting_time,
    CASE l.lead_number
        WHEN 'L122325' THEN 'Jerusalem Office'
        WHEN 'L122326' THEN 'Teams'
        ELSE 'Tel Aviv Office'
    END as meeting_location,
    'Sarah L' as meeting_manager,
    'NIS' as meeting_currency,
    CASE l.lead_number
        WHEN 'L122325' THEN 500
        WHEN 'L122326' THEN 750
        ELSE 1000
    END as meeting_amount,
    CASE l.lead_number
        WHEN 'L122325' THEN 'David K'
        WHEN 'L122326' THEN 'Sarah L'
        ELSE 'Michael R'
    END as expert,
    CASE l.lead_number
        WHEN 'L122325' THEN 'Mindi'
        WHEN 'L122326' THEN 'Anna Zh'
        ELSE 'Yael'
    END as helper,
    'https://teams.microsoft.com/l/meetup-join/sample-' || l.lead_number as teams_meeting_url,
    CASE l.lead_number
        WHEN 'L122325' THEN 'Initial consultation about German citizenship application. Review of grandmother''s documents and discussion of Article 116 restoration process.'
        WHEN 'L122326' THEN 'Follow-up meeting to discuss document requirements. Client has original passport from 1932 that needs verification.'
        ELSE 'Price proposal discussion and next steps. Review of all collected documents and timeline for submission.'
    END as meeting_brief,
    'Anna Zh' as scheduler,
    'scheduled' as status
FROM lead_ids l; 