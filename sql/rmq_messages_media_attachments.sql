-- Multi-image/video album messages (single message row, JSON array of assets).
-- Run against your Supabase project after backup.

ALTER TABLE public.messages
  ADD COLUMN IF NOT EXISTS media_attachments jsonb DEFAULT NULL;

COMMENT ON COLUMN public.messages.media_attachments IS
  'Array of {url, name, type, size} for album-style messages (message_type = album).';

-- Update conversation preview for album messages
CREATE OR REPLACE FUNCTION public.update_conversation_timestamp()
RETURNS TRIGGER AS $$
BEGIN
  UPDATE public.conversations
  SET
    last_message_at = NEW.sent_at,
    last_message_preview = CASE
      WHEN NEW.message_type = 'text' THEN LEFT(NEW.content, 100)
      WHEN NEW.message_type = 'file' THEN '📎 ' || COALESCE(NEW.attachment_name, 'File attachment')
      WHEN NEW.message_type = 'image' THEN '🖼️ Image'
      WHEN NEW.message_type = 'album' THEN
        '🖼️ ' || CASE
          WHEN NEW.media_attachments IS NOT NULL AND jsonb_typeof(NEW.media_attachments) = 'array'
          THEN (jsonb_array_length(NEW.media_attachments))::text || ' media'
          ELSE 'Album'
        END
      ELSE 'Message'
    END,
    updated_at = NOW()
  WHERE id = NEW.conversation_id;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
