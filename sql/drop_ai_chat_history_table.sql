-- Drop AI Chat History table and all related objects
-- WARNING: This will permanently delete all chat history data!

-- Drop the trigger first
DROP TRIGGER IF EXISTS trigger_update_ai_chat_history_updated_at ON ai_chat_history;

-- Drop the trigger function
DROP FUNCTION IF EXISTS update_ai_chat_history_updated_at();

-- Drop the RPC functions
DROP FUNCTION IF EXISTS generate_chat_title(JSONB);
DROP FUNCTION IF EXISTS save_ai_chat_history(TEXT, JSONB, UUID, TEXT[]);
DROP FUNCTION IF EXISTS update_ai_chat_history(UUID, JSONB, TEXT);
DROP FUNCTION IF EXISTS search_ai_chat_history(TEXT);

-- Drop all indexes
DROP INDEX IF EXISTS idx_ai_chat_history_user_id;
DROP INDEX IF EXISTS idx_ai_chat_history_created_at;
DROP INDEX IF EXISTS idx_ai_chat_history_updated_at;
DROP INDEX IF EXISTS idx_ai_chat_history_title;
DROP INDEX IF EXISTS idx_ai_chat_history_tags;
DROP INDEX IF EXISTS idx_ai_chat_history_lead_id;

-- Drop the table (this will also drop all RLS policies)
DROP TABLE IF EXISTS ai_chat_history CASCADE;

-- Verify the table is dropped
SELECT 'ai_chat_history table and all related objects have been dropped successfully' as status;
