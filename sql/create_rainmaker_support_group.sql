-- Create "Rainmaker Support" group and add all active employees
-- This script creates a group conversation and adds all active users as participants

-- Step 1: Create the group conversation
-- Note: We'll use the first active user as the creator, or you can specify a specific user ID
INSERT INTO public.conversations (
    title,
    type,
    created_by,
    created_at,
    updated_at,
    last_message_at,
    is_active,
    description,
    max_participants
)
SELECT 
    'Rainmaker Support' as title,
    'group' as type,
    (SELECT id FROM public.users WHERE is_active = TRUE LIMIT 1) as created_by,
    NOW() as created_at,
    NOW() as updated_at,
    NOW() as last_message_at,
    TRUE as is_active,
    'Support group for all active Rainmaker employees' as description,
    1000 as max_participants
WHERE NOT EXISTS (
    -- Prevent duplicate group creation
    SELECT 1 FROM public.conversations 
    WHERE title = 'Rainmaker Support' 
    AND type = 'group' 
    AND is_active = TRUE
)
RETURNING id;

-- Step 2: Add all active users as participants
-- This uses the conversation ID from the INSERT above
-- If the conversation already exists, we'll get its ID first
WITH new_conversation AS (
    -- Get the conversation ID (either newly created or existing)
    SELECT id 
    FROM public.conversations 
    WHERE title = 'Rainmaker Support' 
    AND type = 'group' 
    AND is_active = TRUE
    ORDER BY created_at DESC
    LIMIT 1
),
active_users AS (
    -- Get all active users
    SELECT id as user_id
    FROM public.users
    WHERE is_active = TRUE
)
INSERT INTO public.conversation_participants (
    conversation_id,
    user_id,
    joined_at,
    last_read_at,
    is_active,
    role,
    notifications_enabled
)
SELECT 
    nc.id as conversation_id,
    au.user_id,
    NOW() as joined_at,
    NOW() as last_read_at,
    TRUE as is_active,
    'member' as role,
    TRUE as notifications_enabled
FROM new_conversation nc
CROSS JOIN active_users au
WHERE NOT EXISTS (
    -- Prevent duplicate participants
    SELECT 1 FROM public.conversation_participants cp
    WHERE cp.conversation_id = nc.id 
    AND cp.user_id = au.user_id
);

-- Verification query: Check the created group and participants
SELECT 
    c.id as conversation_id,
    c.title,
    c.type,
    c.created_at,
    COUNT(cp.id) as participant_count,
    STRING_AGG(u.full_name, ', ' ORDER BY u.full_name) as participant_names
FROM public.conversations c
LEFT JOIN public.conversation_participants cp ON cp.conversation_id = c.id AND cp.is_active = TRUE
LEFT JOIN public.users u ON u.id = cp.user_id
WHERE c.title = 'Rainmaker Support' 
AND c.type = 'group' 
AND c.is_active = TRUE
GROUP BY c.id, c.title, c.type, c.created_at;

