-- =============================================
-- Ensure Reply Functionality Works Correctly in Messages Table
-- =============================================
-- This script adds necessary indexes and constraints to ensure
-- reply functionality works correctly in the messages table

-- 1. Add index on reply_to_message_id for better query performance
-- This is critical for fetching reply messages efficiently
CREATE INDEX IF NOT EXISTS idx_messages_reply_to_message_id 
ON public.messages(reply_to_message_id) 
WHERE reply_to_message_id IS NOT NULL;

-- 2. Add constraint to prevent a message from replying to itself
-- This ensures data integrity
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint 
    WHERE conname = 'messages_cannot_reply_to_self'
  ) THEN
    ALTER TABLE public.messages
    ADD CONSTRAINT messages_cannot_reply_to_self
    CHECK (reply_to_message_id IS NULL OR reply_to_message_id != id);
  END IF;
END $$;

-- 3. Add index on conversation_id and reply_to_message_id together
-- This helps with queries that filter by conversation and check for replies
CREATE INDEX IF NOT EXISTS idx_messages_conversation_reply 
ON public.messages(conversation_id, reply_to_message_id) 
WHERE reply_to_message_id IS NOT NULL;

-- 4. Ensure the foreign key constraint exists and is correct
-- This should already exist, but we'll verify and fix if needed
DO $$
BEGIN
  -- Check if foreign key exists
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint 
    WHERE conname = 'messages_reply_to_message_id_fkey'
    AND conrelid = 'public.messages'::regclass
  ) THEN
    -- Add foreign key if it doesn't exist
    ALTER TABLE public.messages
    ADD CONSTRAINT messages_reply_to_message_id_fkey
    FOREIGN KEY (reply_to_message_id)
    REFERENCES public.messages(id)
    ON DELETE SET NULL;
  END IF;
END $$;

-- 5. Add a function to validate reply chain depth (prevent infinite loops)
-- This ensures messages don't create circular reply chains
CREATE OR REPLACE FUNCTION check_reply_chain_depth()
RETURNS TRIGGER AS $$
DECLARE
  reply_chain_depth INTEGER := 0;
  current_reply_id BIGINT;
BEGIN
  -- Prevent replying to a message that doesn't exist
  IF NEW.reply_to_message_id IS NOT NULL THEN
    -- Check if the replied-to message exists
    IF NOT EXISTS (
      SELECT 1 FROM public.messages WHERE id = NEW.reply_to_message_id
    ) THEN
      RAISE EXCEPTION 'Cannot reply to non-existent message: %', NEW.reply_to_message_id;
    END IF;
    
    -- Check for circular references (message replying to itself)
    IF NEW.reply_to_message_id = NEW.id THEN
      RAISE EXCEPTION 'A message cannot reply to itself';
    END IF;
    
    -- Check reply chain depth (limit to prevent deep nesting)
    current_reply_id := NEW.reply_to_message_id;
    WHILE current_reply_id IS NOT NULL AND reply_chain_depth < 10 LOOP
      SELECT reply_to_message_id INTO current_reply_id
      FROM public.messages
      WHERE id = current_reply_id;
      
      reply_chain_depth := reply_chain_depth + 1;
      
      -- Check for circular reference in chain
      IF current_reply_id = NEW.id THEN
        RAISE EXCEPTION 'Circular reply chain detected';
      END IF;
    END LOOP;
    
    -- Warn if chain is getting deep (but allow it)
    IF reply_chain_depth >= 10 THEN
      RAISE WARNING 'Reply chain depth is % levels deep, which may impact performance', reply_chain_depth;
    END IF;
  END IF;
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- 6. Create trigger to validate reply chains on insert/update
DROP TRIGGER IF EXISTS validate_reply_chain ON public.messages;
CREATE TRIGGER validate_reply_chain
  BEFORE INSERT OR UPDATE OF reply_to_message_id ON public.messages
  FOR EACH ROW
  EXECUTE FUNCTION check_reply_chain_depth();

-- 7. Add comment for documentation
COMMENT ON COLUMN public.messages.reply_to_message_id IS 
'Reference to the message this message is replying to. NULL if this is not a reply. 
Foreign key ensures referential integrity. Indexed for performance.';

-- 8. Verify the setup
DO $$
BEGIN
  RAISE NOTICE 'Reply functionality setup complete:';
  RAISE NOTICE '  - Index on reply_to_message_id: %', 
    CASE WHEN EXISTS (
      SELECT 1 FROM pg_indexes 
      WHERE indexname = 'idx_messages_reply_to_message_id'
    ) THEN 'EXISTS' ELSE 'MISSING' END;
  RAISE NOTICE '  - Foreign key constraint: %',
    CASE WHEN EXISTS (
      SELECT 1 FROM pg_constraint 
      WHERE conname = 'messages_reply_to_message_id_fkey'
    ) THEN 'EXISTS' ELSE 'MISSING' END;
  RAISE NOTICE '  - Self-reply constraint: %',
    CASE WHEN EXISTS (
      SELECT 1 FROM pg_constraint 
      WHERE conname = 'messages_cannot_reply_to_self'
    ) THEN 'EXISTS' ELSE 'MISSING' END;
  RAISE NOTICE '  - Validation trigger: %',
    CASE WHEN EXISTS (
      SELECT 1 FROM pg_trigger 
      WHERE tgname = 'validate_reply_chain'
    ) THEN 'EXISTS' ELSE 'MISSING' END;
END $$;
