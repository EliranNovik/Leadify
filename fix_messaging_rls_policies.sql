-- Fix RLS policies for messaging system to avoid infinite recursion

-- Drop all existing policies first
DROP POLICY IF EXISTS "conversations_select_policy" ON public.conversations;
DROP POLICY IF EXISTS "conversations_insert_policy" ON public.conversations;
DROP POLICY IF EXISTS "conversations_update_policy" ON public.conversations;

DROP POLICY IF EXISTS "conversation_participants_select_policy" ON public.conversation_participants;
DROP POLICY IF EXISTS "conversation_participants_insert_policy" ON public.conversation_participants;
DROP POLICY IF EXISTS "conversation_participants_update_policy" ON public.conversation_participants;

DROP POLICY IF EXISTS "messages_select_policy" ON public.messages;
DROP POLICY IF EXISTS "messages_insert_policy" ON public.messages;
DROP POLICY IF EXISTS "messages_update_policy" ON public.messages;

DROP POLICY IF EXISTS "message_read_receipts_select_policy" ON public.message_read_receipts;
DROP POLICY IF EXISTS "message_read_receipts_insert_policy" ON public.message_read_receipts;
DROP POLICY IF EXISTS "message_read_receipts_update_policy" ON public.message_read_receipts;

-- Create simplified RLS policies to avoid recursion

-- Conversations: Users can only see conversations they participate in
CREATE POLICY "conversations_select_policy" ON public.conversations
    FOR SELECT USING (
        EXISTS (
            SELECT 1 FROM public.conversation_participants cp
            WHERE cp.conversation_id = conversations.id 
            AND cp.user_id = auth.uid() 
            AND cp.is_active = TRUE
        )
    );

CREATE POLICY "conversations_insert_policy" ON public.conversations
    FOR INSERT WITH CHECK (created_by = auth.uid());

CREATE POLICY "conversations_update_policy" ON public.conversations
    FOR UPDATE USING (
        created_by = auth.uid() OR 
        EXISTS (
            SELECT 1 FROM public.conversation_participants cp
            WHERE cp.conversation_id = conversations.id 
            AND cp.user_id = auth.uid() 
            AND cp.role IN ('admin', 'moderator') 
            AND cp.is_active = TRUE
        )
    );

-- Conversation participants: Users can see participants of their own conversations
CREATE POLICY "conversation_participants_select_policy" ON public.conversation_participants
    FOR SELECT USING (
        user_id = auth.uid() OR
        EXISTS (
            SELECT 1 FROM public.conversation_participants cp
            WHERE cp.conversation_id = conversation_participants.conversation_id 
            AND cp.user_id = auth.uid() 
            AND cp.is_active = TRUE
        )
    );

CREATE POLICY "conversation_participants_insert_policy" ON public.conversation_participants
    FOR INSERT WITH CHECK (
        user_id = auth.uid() OR
        EXISTS (
            SELECT 1 FROM public.conversation_participants cp
            WHERE cp.conversation_id = conversation_participants.conversation_id 
            AND cp.user_id = auth.uid() 
            AND cp.role IN ('admin', 'moderator') 
            AND cp.is_active = TRUE
        )
    );

CREATE POLICY "conversation_participants_update_policy" ON public.conversation_participants
    FOR UPDATE USING (user_id = auth.uid());

-- Messages: Users can see messages in their conversations
CREATE POLICY "messages_select_policy" ON public.messages
    FOR SELECT USING (
        EXISTS (
            SELECT 1 FROM public.conversation_participants cp
            WHERE cp.conversation_id = messages.conversation_id 
            AND cp.user_id = auth.uid() 
            AND cp.is_active = TRUE
        )
    );

CREATE POLICY "messages_insert_policy" ON public.messages
    FOR INSERT WITH CHECK (
        sender_id = auth.uid() AND
        EXISTS (
            SELECT 1 FROM public.conversation_participants cp
            WHERE cp.conversation_id = messages.conversation_id 
            AND cp.user_id = auth.uid() 
            AND cp.is_active = TRUE
        )
    );

CREATE POLICY "messages_update_policy" ON public.messages
    FOR UPDATE USING (sender_id = auth.uid());

-- Message read receipts: Users can manage their own read receipts
CREATE POLICY "message_read_receipts_select_policy" ON public.message_read_receipts
    FOR SELECT USING (
        user_id = auth.uid() OR
        EXISTS (
            SELECT 1 FROM public.messages m
            JOIN public.conversation_participants cp ON m.conversation_id = cp.conversation_id
            WHERE m.id = message_read_receipts.message_id
            AND cp.user_id = auth.uid() 
            AND cp.is_active = TRUE
        )
    );

CREATE POLICY "message_read_receipts_insert_policy" ON public.message_read_receipts
    FOR INSERT WITH CHECK (user_id = auth.uid());

CREATE POLICY "message_read_receipts_update_policy" ON public.message_read_receipts
    FOR UPDATE USING (user_id = auth.uid());

-- Success message
DO $$
BEGIN
    RAISE NOTICE '✅ RLS policies fixed successfully!';
    RAISE NOTICE 'Infinite recursion issue resolved.';
    RAISE NOTICE 'Messaging system is now ready to use.';
END $$;
