-- Create comprehensive messaging system tables for RMQ CRM
-- This script creates tables for internal employee messaging

-- 1. Create conversations table (chat threads between users)
CREATE TABLE IF NOT EXISTS public.conversations (
    id BIGSERIAL PRIMARY KEY,
    title VARCHAR(255) NULL, -- Optional conversation title
    type VARCHAR(50) NOT NULL DEFAULT 'direct', -- 'direct', 'group', 'announcement'
    created_by UUID NOT NULL REFERENCES public.users(ids) ON DELETE CASCADE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    last_message_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    last_message_preview TEXT NULL, -- Preview of the last message
    is_active BOOLEAN DEFAULT TRUE,
    -- Metadata for group conversations
    description TEXT NULL,
    max_participants INTEGER DEFAULT 50
);

-- 2. Create conversation_participants table (many-to-many relationship)
CREATE TABLE IF NOT EXISTS public.conversation_participants (
    id BIGSERIAL PRIMARY KEY,
    conversation_id BIGINT NOT NULL REFERENCES public.conversations(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES public.users(ids) ON DELETE CASCADE,
    joined_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    last_read_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    is_active BOOLEAN DEFAULT TRUE, -- Can leave/be removed from conversation
    role VARCHAR(50) DEFAULT 'member', -- 'admin', 'member', 'moderator'
    -- Notification preferences
    notifications_enabled BOOLEAN DEFAULT TRUE,
    -- Unique constraint to prevent duplicate participants
    UNIQUE(conversation_id, user_id)
);

-- 3. Create messages table (individual messages in conversations)
CREATE TABLE IF NOT EXISTS public.messages (
    id BIGSERIAL PRIMARY KEY,
    conversation_id BIGINT NOT NULL REFERENCES public.conversations(id) ON DELETE CASCADE,
    sender_id UUID NOT NULL REFERENCES public.users(ids) ON DELETE CASCADE,
    content TEXT NOT NULL,
    message_type VARCHAR(50) DEFAULT 'text', -- 'text', 'file', 'image', 'system'
    sent_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    edited_at TIMESTAMP WITH TIME ZONE NULL,
    is_deleted BOOLEAN DEFAULT FALSE,
    -- File/attachment support
    attachment_url TEXT NULL,
    attachment_name TEXT NULL,
    attachment_type VARCHAR(100) NULL, -- MIME type
    attachment_size BIGINT NULL, -- Size in bytes
    -- Message status
    delivery_status VARCHAR(50) DEFAULT 'sent', -- 'sent', 'delivered', 'read'
    -- Reply/thread support
    reply_to_message_id BIGINT NULL REFERENCES public.messages(id) ON DELETE SET NULL,
    -- Reactions/emoji support (JSON array)
    reactions JSONB DEFAULT '[]'::jsonb
);

-- 4. Create message_read_receipts table (track who has read which messages)
CREATE TABLE IF NOT EXISTS public.message_read_receipts (
    id BIGSERIAL PRIMARY KEY,
    message_id BIGINT NOT NULL REFERENCES public.messages(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES public.users(ids) ON DELETE CASCADE,
    read_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    -- Unique constraint to prevent duplicate read receipts
    UNIQUE(message_id, user_id)
);

-- 5. Create indexes for performance
CREATE INDEX IF NOT EXISTS idx_conversations_created_by ON public.conversations(created_by);
CREATE INDEX IF NOT EXISTS idx_conversations_updated_at ON public.conversations(updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_conversations_last_message_at ON public.conversations(last_message_at DESC);
CREATE INDEX IF NOT EXISTS idx_conversations_type ON public.conversations(type);

CREATE INDEX IF NOT EXISTS idx_conversation_participants_conversation_id ON public.conversation_participants(conversation_id);
CREATE INDEX IF NOT EXISTS idx_conversation_participants_user_id ON public.conversation_participants(user_id);
CREATE INDEX IF NOT EXISTS idx_conversation_participants_last_read_at ON public.conversation_participants(last_read_at);

CREATE INDEX IF NOT EXISTS idx_messages_conversation_id ON public.messages(conversation_id);
CREATE INDEX IF NOT EXISTS idx_messages_sender_id ON public.messages(sender_id);
CREATE INDEX IF NOT EXISTS idx_messages_sent_at ON public.messages(sent_at DESC);
CREATE INDEX IF NOT EXISTS idx_messages_reply_to ON public.messages(reply_to_message_id);
CREATE INDEX IF NOT EXISTS idx_messages_deleted ON public.messages(is_deleted);

CREATE INDEX IF NOT EXISTS idx_message_read_receipts_message_id ON public.message_read_receipts(message_id);
CREATE INDEX IF NOT EXISTS idx_message_read_receipts_user_id ON public.message_read_receipts(user_id);

-- 6. Create function to update conversation timestamps
CREATE OR REPLACE FUNCTION update_conversation_timestamp()
RETURNS TRIGGER AS $$
BEGIN
    -- Update the conversation's last_message_at and last_message_preview
    UPDATE public.conversations 
    SET 
        last_message_at = NEW.sent_at,
        last_message_preview = CASE 
            WHEN NEW.message_type = 'text' THEN LEFT(NEW.content, 100)
            WHEN NEW.message_type = 'file' THEN '📎 ' || COALESCE(NEW.attachment_name, 'File attachment')
            WHEN NEW.message_type = 'image' THEN '🖼️ Image'
            ELSE 'Message'
        END,
        updated_at = NOW()
    WHERE id = NEW.conversation_id;
    
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- 7. Create trigger for conversation timestamp updates
DROP TRIGGER IF EXISTS trigger_update_conversation_timestamp ON public.messages;
CREATE TRIGGER trigger_update_conversation_timestamp
    AFTER INSERT ON public.messages
    FOR EACH ROW
    EXECUTE FUNCTION update_conversation_timestamp();

-- 8. Create function to get unread message count for a user
CREATE OR REPLACE FUNCTION get_unread_message_count(user_uuid UUID)
RETURNS INTEGER AS $$
DECLARE
    unread_count INTEGER;
BEGIN
    SELECT COUNT(DISTINCT m.id) INTO unread_count
    FROM public.messages m
    JOIN public.conversation_participants cp ON m.conversation_id = cp.conversation_id
    WHERE cp.user_id = user_uuid
    AND cp.is_active = TRUE
    AND m.sent_at > cp.last_read_at
    AND m.sender_id != user_uuid
    AND m.is_deleted = FALSE;
    
    RETURN COALESCE(unread_count, 0);
END;
$$ LANGUAGE plpgsql;

-- 9. Create function to mark conversation as read for a user
CREATE OR REPLACE FUNCTION mark_conversation_as_read(conv_id BIGINT, user_uuid UUID)
RETURNS VOID AS $$
BEGIN
    UPDATE public.conversation_participants
    SET last_read_at = NOW()
    WHERE conversation_id = conv_id AND user_id = user_uuid;
END;
$$ LANGUAGE plpgsql;

-- 10. Create function to create a new direct conversation between two users
CREATE OR REPLACE FUNCTION create_direct_conversation(user1_uuid UUID, user2_uuid UUID)
RETURNS BIGINT AS $$
DECLARE
    conv_id BIGINT;
    existing_conv_id BIGINT;
BEGIN
    -- Check if a direct conversation already exists between these two users
    SELECT c.id INTO existing_conv_id
    FROM public.conversations c
    WHERE c.type = 'direct'
    AND EXISTS (
        SELECT 1 FROM public.conversation_participants cp1 
        WHERE cp1.conversation_id = c.id AND cp1.user_id = user1_uuid AND cp1.is_active = TRUE
    )
    AND EXISTS (
        SELECT 1 FROM public.conversation_participants cp2 
        WHERE cp2.conversation_id = c.id AND cp2.user_id = user2_uuid AND cp2.is_active = TRUE
    )
    AND (
        SELECT COUNT(*) FROM public.conversation_participants cp 
        WHERE cp.conversation_id = c.id AND cp.is_active = TRUE
    ) = 2;

    IF existing_conv_id IS NOT NULL THEN
        RETURN existing_conv_id;
    END IF;

    -- Create new conversation
    INSERT INTO public.conversations (type, created_by)
    VALUES ('direct', user1_uuid)
    RETURNING id INTO conv_id;

    -- Add both users as participants
    INSERT INTO public.conversation_participants (conversation_id, user_id, role)
    VALUES 
        (conv_id, user1_uuid, 'member'),
        (conv_id, user2_uuid, 'member');

    RETURN conv_id;
END;
$$ LANGUAGE plpgsql;

-- 11. Enable Row Level Security (RLS) on all tables
ALTER TABLE public.conversations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.conversation_participants ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.message_read_receipts ENABLE ROW LEVEL SECURITY;

-- 12. Create RLS policies for secure access

-- Conversations: Users can only see conversations they participate in
DROP POLICY IF EXISTS "conversations_select_policy" ON public.conversations;
CREATE POLICY "conversations_select_policy" ON public.conversations
    FOR SELECT USING (
        id IN (
            SELECT conversation_id 
            FROM public.conversation_participants 
            WHERE user_id = auth.uid() AND is_active = TRUE
        )
    );

DROP POLICY IF EXISTS "conversations_insert_policy" ON public.conversations;
CREATE POLICY "conversations_insert_policy" ON public.conversations
    FOR INSERT WITH CHECK (created_by = auth.uid());

DROP POLICY IF EXISTS "conversations_update_policy" ON public.conversations;
CREATE POLICY "conversations_update_policy" ON public.conversations
    FOR UPDATE USING (
        created_by = auth.uid() OR 
        id IN (
            SELECT conversation_id 
            FROM public.conversation_participants 
            WHERE user_id = auth.uid() AND role IN ('admin', 'moderator') AND is_active = TRUE
        )
    );

-- Conversation participants: Users can see participants of conversations they're in
DROP POLICY IF EXISTS "conversation_participants_select_policy" ON public.conversation_participants;
CREATE POLICY "conversation_participants_select_policy" ON public.conversation_participants
    FOR SELECT USING (
        conversation_id IN (
            SELECT conversation_id 
            FROM public.conversation_participants 
            WHERE user_id = auth.uid() AND is_active = TRUE
        )
    );

DROP POLICY IF EXISTS "conversation_participants_insert_policy" ON public.conversation_participants;
CREATE POLICY "conversation_participants_insert_policy" ON public.conversation_participants
    FOR INSERT WITH CHECK (
        user_id = auth.uid() OR
        conversation_id IN (
            SELECT conversation_id 
            FROM public.conversation_participants 
            WHERE user_id = auth.uid() AND role IN ('admin', 'moderator') AND is_active = TRUE
        )
    );

DROP POLICY IF EXISTS "conversation_participants_update_policy" ON public.conversation_participants;
CREATE POLICY "conversation_participants_update_policy" ON public.conversation_participants
    FOR UPDATE USING (user_id = auth.uid());

-- Messages: Users can see messages in conversations they participate in
DROP POLICY IF EXISTS "messages_select_policy" ON public.messages;
CREATE POLICY "messages_select_policy" ON public.messages
    FOR SELECT USING (
        conversation_id IN (
            SELECT conversation_id 
            FROM public.conversation_participants 
            WHERE user_id = auth.uid() AND is_active = TRUE
        )
    );

DROP POLICY IF EXISTS "messages_insert_policy" ON public.messages;
CREATE POLICY "messages_insert_policy" ON public.messages
    FOR INSERT WITH CHECK (
        sender_id = auth.uid() AND
        conversation_id IN (
            SELECT conversation_id 
            FROM public.conversation_participants 
            WHERE user_id = auth.uid() AND is_active = TRUE
        )
    );

DROP POLICY IF EXISTS "messages_update_policy" ON public.messages;
CREATE POLICY "messages_update_policy" ON public.messages
    FOR UPDATE USING (sender_id = auth.uid());

-- Message read receipts: Users can manage their own read receipts
DROP POLICY IF EXISTS "message_read_receipts_select_policy" ON public.message_read_receipts;
CREATE POLICY "message_read_receipts_select_policy" ON public.message_read_receipts
    FOR SELECT USING (
        message_id IN (
            SELECT m.id FROM public.messages m
            JOIN public.conversation_participants cp ON m.conversation_id = cp.conversation_id
            WHERE cp.user_id = auth.uid() AND cp.is_active = TRUE
        )
    );

DROP POLICY IF EXISTS "message_read_receipts_insert_policy" ON public.message_read_receipts;
CREATE POLICY "message_read_receipts_insert_policy" ON public.message_read_receipts
    FOR INSERT WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS "message_read_receipts_update_policy" ON public.message_read_receipts;
CREATE POLICY "message_read_receipts_update_policy" ON public.message_read_receipts
    FOR UPDATE USING (user_id = auth.uid());

-- 13. Insert some initial system conversations
DO $$
DECLARE
    admin_user_id UUID;
    general_conv_id BIGINT;
    announcements_conv_id BIGINT;
BEGIN
    -- Find first admin user
    SELECT ids INTO admin_user_id
    FROM public.users
    WHERE is_superuser = TRUE OR is_staff = TRUE
    ORDER BY created_at ASC
    LIMIT 1;

    IF admin_user_id IS NOT NULL THEN
        -- Create General Discussion group
        INSERT INTO public.conversations (title, type, created_by, description)
        VALUES ('General Discussion', 'group', admin_user_id, 'General workplace discussions and updates')
        ON CONFLICT DO NOTHING
        RETURNING id INTO general_conv_id;

        -- Create Announcements group  
        INSERT INTO public.conversations (title, type, created_by, description)
        VALUES ('Announcements', 'announcement', admin_user_id, 'Important company announcements and updates')
        ON CONFLICT DO NOTHING
        RETURNING id INTO announcements_conv_id;

        -- Add all active users to General Discussion
        IF general_conv_id IS NOT NULL THEN
            INSERT INTO public.conversation_participants (conversation_id, user_id, role)
            SELECT general_conv_id, ids, 'member'
            FROM public.users
            WHERE is_active = TRUE
            ON CONFLICT (conversation_id, user_id) DO NOTHING;
        END IF;

        -- Add all active users to Announcements (as members, only admins can post)
        IF announcements_conv_id IS NOT NULL THEN
            INSERT INTO public.conversation_participants (conversation_id, user_id, role)
            SELECT announcements_conv_id, ids, 
                CASE WHEN is_superuser = TRUE OR is_staff = TRUE THEN 'admin' ELSE 'member' END
            FROM public.users
            WHERE is_active = TRUE
            ON CONFLICT (conversation_id, user_id) DO NOTHING;
        END IF;

        RAISE NOTICE 'Created default group conversations and added all users as participants.';
    ELSE
        RAISE NOTICE 'No admin user found, skipping default group creation.';
    END IF;
    
    RAISE NOTICE '=== RMQ Messaging System Setup Complete ===';
    RAISE NOTICE 'Tables created: conversations, conversation_participants, messages, message_read_receipts';
    RAISE NOTICE 'Functions created: get_unread_message_count, mark_conversation_as_read, create_direct_conversation';
    RAISE NOTICE 'RLS policies applied for secure access';
    RAISE NOTICE 'Default group conversations created for all users';
    RAISE NOTICE 'Ready to use! Navigate to /messages in your application.';
END $$;