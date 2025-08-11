-- Create AI Chat History table
CREATE TABLE IF NOT EXISTS ai_chat_history (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
    title VARCHAR(255) NOT NULL,
    messages JSONB NOT NULL DEFAULT '[]',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    is_archived BOOLEAN DEFAULT FALSE,
    tags TEXT[] DEFAULT '{}',
    summary TEXT,
    lead_id UUID REFERENCES leads(id) ON DELETE SET NULL,
    session_duration INTEGER, -- in seconds
    message_count INTEGER DEFAULT 0,
    last_message_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Create indexes for better performance
CREATE INDEX IF NOT EXISTS idx_ai_chat_history_user_id ON ai_chat_history(user_id);
CREATE INDEX IF NOT EXISTS idx_ai_chat_history_created_at ON ai_chat_history(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_ai_chat_history_updated_at ON ai_chat_history(updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_ai_chat_history_title ON ai_chat_history USING gin(to_tsvector('english', title));
CREATE INDEX IF NOT EXISTS idx_ai_chat_history_tags ON ai_chat_history USING gin(tags);
CREATE INDEX IF NOT EXISTS idx_ai_chat_history_lead_id ON ai_chat_history(lead_id);

-- Create a function to update the updated_at timestamp
CREATE OR REPLACE FUNCTION update_ai_chat_history_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Create trigger to automatically update updated_at
CREATE TRIGGER trigger_update_ai_chat_history_updated_at
    BEFORE UPDATE ON ai_chat_history
    FOR EACH ROW
    EXECUTE FUNCTION update_ai_chat_history_updated_at();

-- Enable Row Level Security (RLS)
ALTER TABLE ai_chat_history ENABLE ROW LEVEL SECURITY;

-- Create RLS policies
CREATE POLICY "Users can view their own chat history" ON ai_chat_history
    FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "Users can insert their own chat history" ON ai_chat_history
    FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update their own chat history" ON ai_chat_history
    FOR UPDATE USING (auth.uid() = user_id);

CREATE POLICY "Users can delete their own chat history" ON ai_chat_history
    FOR DELETE USING (auth.uid() = user_id);

-- Create a function to generate chat title from first message
CREATE OR REPLACE FUNCTION generate_chat_title(messages JSONB)
RETURNS TEXT AS $$
DECLARE
    first_message TEXT;
    title TEXT;
BEGIN
    -- Extract the first user message content
    SELECT msg->>'content' INTO first_message
    FROM jsonb_array_elements(messages) AS msg
    WHERE msg->>'role' = 'user'
    LIMIT 1;
    
    -- Generate title from first message (truncate to 50 chars)
    IF first_message IS NOT NULL THEN
        title := LEFT(first_message, 50);
        IF LENGTH(first_message) > 50 THEN
            title := title || '...';
        END IF;
    ELSE
        title := 'New Conversation';
    END IF;
    
    RETURN title;
END;
$$ LANGUAGE plpgsql;

-- Create a function to save chat history
CREATE OR REPLACE FUNCTION save_ai_chat_history(
    p_title TEXT,
    p_messages JSONB,
    p_lead_id UUID DEFAULT NULL,
    p_tags TEXT[] DEFAULT '{}'
)
RETURNS UUID AS $$
DECLARE
    chat_id UUID;
    chat_title TEXT;
BEGIN
    -- Generate title if not provided
    IF p_title IS NULL OR p_title = '' THEN
        chat_title := generate_chat_title(p_messages);
    ELSE
        chat_title := p_title;
    END IF;
    
    -- Insert new chat history
    INSERT INTO ai_chat_history (
        user_id,
        title,
        messages,
        lead_id,
        tags,
        message_count,
        last_message_at
    ) VALUES (
        auth.uid(),
        chat_title,
        p_messages,
        p_lead_id,
        p_tags,
        jsonb_array_length(p_messages),
        NOW()
    ) RETURNING id INTO chat_id;
    
    RETURN chat_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Create a function to update existing chat history
CREATE OR REPLACE FUNCTION update_ai_chat_history(
    p_chat_id UUID,
    p_messages JSONB,
    p_title TEXT DEFAULT NULL
)
RETURNS BOOLEAN AS $$
DECLARE
    chat_title TEXT;
BEGIN
    -- Generate title if not provided
    IF p_title IS NULL OR p_title = '' THEN
        chat_title := generate_chat_title(p_messages);
    ELSE
        chat_title := p_title;
    END IF;
    
    -- Update chat history
    UPDATE ai_chat_history 
    SET 
        messages = p_messages,
        title = chat_title,
        message_count = jsonb_array_length(p_messages),
        last_message_at = NOW()
    WHERE id = p_chat_id AND user_id = auth.uid();
    
    RETURN FOUND;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Create a function to search chat history
CREATE OR REPLACE FUNCTION search_ai_chat_history(p_search_term TEXT)
RETURNS TABLE (
    id UUID,
    title VARCHAR(255),
    created_at TIMESTAMP WITH TIME ZONE,
    updated_at TIMESTAMP WITH TIME ZONE,
    message_count INTEGER,
    summary TEXT,
    tags TEXT[]
) AS $$
BEGIN
    RETURN QUERY
    SELECT 
        ach.id,
        ach.title::VARCHAR(255),
        ach.created_at,
        ach.updated_at,
        ach.message_count,
        ach.summary,
        ach.tags
    FROM ai_chat_history ach
    WHERE ach.user_id = auth.uid()
    AND ach.is_archived = FALSE
    AND (
        ach.title ILIKE '%' || p_search_term || '%'
        OR ach.summary ILIKE '%' || p_search_term || '%'
        OR p_search_term = ANY(ach.tags)
    )
    ORDER BY ach.updated_at DESC;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
