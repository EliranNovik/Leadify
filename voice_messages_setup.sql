-- Voice Messages Setup for RMQ Messages
-- This adds voice message functionality similar to WhatsApp

-- 1. Add voice message columns to the existing messages table
ALTER TABLE messages 
ADD COLUMN IF NOT EXISTS voice_duration INTEGER, -- Duration in seconds
ADD COLUMN IF NOT EXISTS voice_waveform JSONB, -- Audio waveform data for visualization
ADD COLUMN IF NOT EXISTS is_voice_message BOOLEAN DEFAULT FALSE; -- Flag to identify voice messages

-- 2. Create voice_message_sessions table to track recording sessions
CREATE TABLE IF NOT EXISTS voice_message_sessions (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    conversation_id INTEGER NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
    session_token VARCHAR(255) UNIQUE NOT NULL, -- Unique token for each recording session
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    expires_at TIMESTAMP WITH TIME ZONE DEFAULT NOW() + INTERVAL '1 hour', -- Sessions expire after 1 hour
    status VARCHAR(20) DEFAULT 'recording' CHECK (status IN ('recording', 'completed', 'cancelled', 'expired')),
    metadata JSONB DEFAULT '{}' -- Store additional session metadata
);

-- 3. Create voice_message_chunks table for handling large audio files in chunks
CREATE TABLE IF NOT EXISTS voice_message_chunks (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    session_id UUID NOT NULL REFERENCES voice_message_sessions(id) ON DELETE CASCADE,
    chunk_number INTEGER NOT NULL, -- Order of the chunk (0, 1, 2, ...)
    chunk_data BYTEA NOT NULL, -- The actual audio chunk data
    chunk_size INTEGER NOT NULL, -- Size of this chunk in bytes
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    UNIQUE(session_id, chunk_number)
);

-- 4. Add indexes for performance
CREATE INDEX IF NOT EXISTS idx_messages_is_voice_message ON messages(is_voice_message);
CREATE INDEX IF NOT EXISTS idx_voice_message_sessions_user_id ON voice_message_sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_voice_message_sessions_conversation_id ON voice_message_sessions(conversation_id);
CREATE INDEX IF NOT EXISTS idx_voice_message_sessions_status ON voice_message_sessions(status);
CREATE INDEX IF NOT EXISTS idx_voice_message_sessions_expires_at ON voice_message_sessions(expires_at);
CREATE INDEX IF NOT EXISTS idx_voice_message_chunks_session_id ON voice_message_chunks(session_id);
CREATE INDEX IF NOT EXISTS idx_voice_message_chunks_chunk_number ON voice_message_chunks(session_id, chunk_number);

-- 5. Create RPC functions for voice message operations

-- Function to create a new voice message session
CREATE OR REPLACE FUNCTION create_voice_message_session(
    p_user_id UUID,
    p_conversation_id INTEGER
) RETURNS JSON AS $$
DECLARE
    v_session_id UUID;
    v_session_token VARCHAR(255);
BEGIN
    -- Generate unique session token
    v_session_token := encode(gen_random_bytes(32), 'hex');
    
    -- Create session
    INSERT INTO voice_message_sessions (user_id, conversation_id, session_token)
    VALUES (p_user_id, p_conversation_id, v_session_token)
    RETURNING id INTO v_session_id;
    
    -- Return session info
    RETURN json_build_object(
        'session_id', v_session_id,
        'session_token', v_session_token,
        'expires_at', NOW() + INTERVAL '1 hour'
    );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Function to upload voice message chunk
CREATE OR REPLACE FUNCTION upload_voice_chunk(
    p_session_token VARCHAR(255),
    p_chunk_number INTEGER,
    p_chunk_data BYTEA,
    p_chunk_size INTEGER
) RETURNS JSON AS $$
DECLARE
    v_session_id UUID;
    v_user_id UUID;
BEGIN
    -- Verify session exists and is valid
    SELECT id, user_id INTO v_session_id, v_user_id
    FROM voice_message_sessions
    WHERE session_token = p_session_token
    AND status = 'recording'
    AND expires_at > NOW();
    
    IF v_session_id IS NULL THEN
        RETURN json_build_object('error', 'Invalid or expired session');
    END IF;
    
    -- Insert chunk
    INSERT INTO voice_message_chunks (session_id, chunk_number, chunk_data, chunk_size)
    VALUES (v_session_id, p_chunk_number, p_chunk_data, p_chunk_size)
    ON CONFLICT (session_id, chunk_number) DO UPDATE SET
        chunk_data = EXCLUDED.chunk_data,
        chunk_size = EXCLUDED.chunk_size;
    
    RETURN json_build_object('success', true, 'chunk_uploaded', p_chunk_number);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Function to finalize voice message
CREATE OR REPLACE FUNCTION finalize_voice_message(
    p_session_token VARCHAR(255),
    p_duration INTEGER,
    p_waveform_data JSONB DEFAULT NULL
) RETURNS JSON AS $$
DECLARE
    v_session_id UUID;
    v_user_id UUID;
    v_conversation_id INTEGER;
    v_message_id INTEGER;
    v_total_chunks INTEGER;
    v_total_size BIGINT;
BEGIN
    -- Get session info
    SELECT id, user_id, conversation_id INTO v_session_id, v_user_id, v_conversation_id
    FROM voice_message_sessions
    WHERE session_token = p_session_token
    AND status = 'recording'
    AND expires_at > NOW();
    
    IF v_session_id IS NULL THEN
        RETURN json_build_object('error', 'Invalid or expired session');
    END IF;
    
    -- Get chunk statistics
    SELECT COUNT(*), COALESCE(SUM(chunk_size), 0) INTO v_total_chunks, v_total_size
    FROM voice_message_chunks
    WHERE session_id = v_session_id;
    
    -- Create message record
    INSERT INTO messages (
        conversation_id,
        sender_id,
        content,
        message_type,
        attachment_url, -- Will be generated from chunks
        attachment_name,
        attachment_type,
        attachment_size,
        voice_duration,
        voice_waveform,
        is_voice_message
    ) VALUES (
        v_conversation_id,
        v_user_id,
        'Voice message', -- Default content for voice messages
        'voice',
        'voice_message_' || v_session_id::text || '.webm', -- Generated filename
        'voice_message.webm',
        'audio/webm',
        v_total_size,
        p_duration,
        p_waveform_data,
        TRUE
    ) RETURNING id INTO v_message_id;
    
    -- Update session status
    UPDATE voice_message_sessions
    SET status = 'completed'
    WHERE id = v_session_id;
    
    RETURN json_build_object(
        'success', true,
        'message_id', v_message_id,
        'total_chunks', v_total_chunks,
        'total_size', v_total_size
    );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Function to get voice message chunks
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
BEGIN
    -- Verify user is participant in conversation
    SELECT m.conversation_id INTO v_conversation_id
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
    
    -- Return chunks in order
    RETURN QUERY
    SELECT vc.chunk_number, vc.chunk_data, vc.chunk_size
    FROM voice_message_chunks vc
    JOIN voice_message_sessions vs ON vc.session_id = vs.id
    WHERE vs.id = (
        SELECT vs2.id FROM voice_message_sessions vs2
        WHERE vs2.id = (
            SELECT id FROM voice_message_sessions
            WHERE conversation_id = v_conversation_id
            AND user_id = (
                SELECT sender_id FROM messages WHERE id = p_message_id
            )
            ORDER BY created_at DESC LIMIT 1
        )
    )
    ORDER BY vc.chunk_number;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Function to cancel voice message session
CREATE OR REPLACE FUNCTION cancel_voice_message_session(
    p_session_token VARCHAR(255)
) RETURNS JSON AS $$
DECLARE
    v_session_id UUID;
BEGIN
    -- Get session ID
    SELECT id INTO v_session_id
    FROM voice_message_sessions
    WHERE session_token = p_session_token
    AND status = 'recording';
    
    IF v_session_id IS NULL THEN
        RETURN json_build_object('error', 'Session not found or already completed');
    END IF;
    
    -- Update session status
    UPDATE voice_message_sessions
    SET status = 'cancelled'
    WHERE id = v_session_id;
    
    -- Delete chunks
    DELETE FROM voice_message_chunks WHERE session_id = v_session_id;
    
    RETURN json_build_object('success', true, 'session_cancelled', true);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 6. Create cleanup function for expired sessions (run this periodically)
CREATE OR REPLACE FUNCTION cleanup_expired_voice_sessions() RETURNS INTEGER AS $$
DECLARE
    v_deleted_sessions INTEGER;
    v_deleted_chunks INTEGER;
BEGIN
    -- Delete expired sessions and their chunks
    DELETE FROM voice_message_sessions
    WHERE expires_at < NOW() OR status IN ('cancelled', 'expired');
    
    GET DIAGNOSTICS v_deleted_sessions = ROW_COUNT;
    
    -- Also clean up orphaned chunks
    DELETE FROM voice_message_chunks
    WHERE session_id NOT IN (SELECT id FROM voice_message_sessions);
    
    GET DIAGNOSTICS v_deleted_chunks = ROW_COUNT;
    
    RETURN v_deleted_sessions + v_deleted_chunks;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 7. Add RLS policies for voice message tables
ALTER TABLE voice_message_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE voice_message_chunks ENABLE ROW LEVEL SECURITY;

-- Policy for voice_message_sessions
CREATE POLICY "Users can access their own voice message sessions" ON voice_message_sessions
    FOR ALL USING (user_id = auth.uid());

-- Policy for voice_message_chunks (through session ownership)
CREATE POLICY "Users can access chunks from their sessions" ON voice_message_chunks
    FOR ALL USING (
        session_id IN (
            SELECT id FROM voice_message_sessions WHERE user_id = auth.uid()
        )
    );

-- 8. Grant necessary permissions
GRANT USAGE ON SCHEMA public TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON voice_message_sessions TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON voice_message_chunks TO authenticated;
GRANT EXECUTE ON FUNCTION create_voice_message_session TO authenticated;
GRANT EXECUTE ON FUNCTION upload_voice_chunk TO authenticated;
GRANT EXECUTE ON FUNCTION finalize_voice_message TO authenticated;
GRANT EXECUTE ON FUNCTION get_voice_message_chunks TO authenticated;
GRANT EXECUTE ON FUNCTION cancel_voice_message_session TO authenticated;
GRANT EXECUTE ON FUNCTION cleanup_expired_voice_sessions TO authenticated;

-- 9. Create a view for easy voice message querying
CREATE OR REPLACE VIEW voice_messages_view AS
SELECT 
    m.id as message_id,
    m.conversation_id,
    m.sender_id,
    m.content,
    m.sent_at,
    m.voice_duration,
    m.voice_waveform,
    m.attachment_url,
    m.attachment_size,
    u.full_name as sender_name,
    te.display_name as sender_display_name
FROM messages m
LEFT JOIN users u ON m.sender_id = u.id
LEFT JOIN tenants_employee te ON u.employee_id = te.id
WHERE m.is_voice_message = TRUE;

-- Grant access to the view
GRANT SELECT ON voice_messages_view TO authenticated;

-- 10. Add comments for documentation
COMMENT ON TABLE voice_message_sessions IS 'Tracks voice message recording sessions';
COMMENT ON TABLE voice_message_chunks IS 'Stores voice message audio data in chunks for efficient upload';
COMMENT ON COLUMN messages.voice_duration IS 'Duration of voice message in seconds';
COMMENT ON COLUMN messages.voice_waveform IS 'Audio waveform data for visualization';
COMMENT ON COLUMN messages.is_voice_message IS 'Flag to identify voice messages';

COMMENT ON FUNCTION create_voice_message_session IS 'Creates a new voice message recording session';
COMMENT ON FUNCTION upload_voice_chunk IS 'Uploads a chunk of voice message audio data';
COMMENT ON FUNCTION finalize_voice_message IS 'Finalizes a voice message and creates the message record';
COMMENT ON FUNCTION get_voice_message_chunks IS 'Retrieves voice message chunks for playback';
COMMENT ON FUNCTION cancel_voice_message_session IS 'Cancels a voice message recording session';
COMMENT ON FUNCTION cleanup_expired_voice_sessions IS 'Cleans up expired voice message sessions and chunks';

-- Success message
DO $$
BEGIN
    RAISE NOTICE 'Voice messages setup completed successfully!';
    RAISE NOTICE 'Features added:';
    RAISE NOTICE '- Voice message recording sessions';
    RAISE NOTICE '- Chunked audio upload for large files';
    RAISE NOTICE '- Voice message duration and waveform support';
    RAISE NOTICE '- WhatsApp-like voice message functionality';
    RAISE NOTICE '- Automatic cleanup of expired sessions';
END $$;
