-- Fix get_voice_message_chunks to use session_id from attachment_url
-- This fixes the issue where all voice messages play the last recorded message
-- 
-- This migration can be run safely multiple times as it uses CREATE OR REPLACE

CREATE OR REPLACE FUNCTION get_voice_message_chunks(
    p_message_id INTEGER,
    p_user_id UUID
) RETURNS TABLE (
    chunk_number INTEGER,
    chunk_data BYTEA,
    chunk_size INTEGER
) AS $$
DECLARE
    v_conversation_id INTEGER;
    v_is_participant BOOLEAN;
    v_session_id UUID;
    v_attachment_url TEXT;
BEGIN
    -- Get message info including attachment_url which contains the session_id
    SELECT m.conversation_id, m.attachment_url INTO v_conversation_id, v_attachment_url
    FROM messages m
    WHERE m.id = p_message_id AND m.is_voice_message = TRUE;
    
    IF v_conversation_id IS NULL THEN
        RETURN;
    END IF;
    
    -- Check if user is participant
    SELECT EXISTS(
        SELECT 1 FROM conversation_participants
        WHERE conversation_id = v_conversation_id AND user_id = p_user_id
    ) INTO v_is_participant;
    
    IF NOT v_is_participant THEN
        RETURN;
    END IF;
    
    -- Extract session_id from attachment_url
    -- Format: 'voice_message_' || session_id || '.webm'
    IF v_attachment_url IS NOT NULL AND v_attachment_url LIKE 'voice_message_%.webm' THEN
        -- Extract UUID from attachment_url (between 'voice_message_' and '.webm')
        v_session_id := substring(v_attachment_url from 'voice_message_(.+?)\.webm')::UUID;
    END IF;
    
    -- If we couldn't extract session_id from attachment_url, fall back to finding by message sender and conversation
    -- This is a fallback for older messages that might not have the session_id in attachment_url
    IF v_session_id IS NULL THEN
        SELECT vs.id INTO v_session_id
        FROM voice_message_sessions vs
        JOIN messages m ON m.conversation_id = vs.conversation_id 
            AND m.sender_id = vs.user_id
        WHERE m.id = p_message_id
            AND vs.status = 'completed'
        ORDER BY vs.created_at DESC
        LIMIT 1;
    END IF;
    
    IF v_session_id IS NULL THEN
        RETURN;
    END IF;
    
    -- Return chunks for the specific session
    RETURN QUERY
    SELECT vc.chunk_number, vc.chunk_data, vc.chunk_size
    FROM voice_message_chunks vc
    WHERE vc.session_id = v_session_id
    ORDER BY vc.chunk_number;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

