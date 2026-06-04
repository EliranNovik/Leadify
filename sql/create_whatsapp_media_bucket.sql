-- Private bucket for durable storage of WhatsApp media (incoming images, voice notes, documents, video).
-- WhatsApp's own media IDs expire after ~30 days and the backend's local disk is ephemeral,
-- so incoming media is copied here once and served from here forever.
--
-- Object key convention mirrors the existing filename: "{leadId}_{timestamp}_{whatsappMediaId}.{ext}"
-- (kept flat so historical media_url values stay valid).
--
-- Access model: the bucket is PRIVATE. The backend uses the Supabase SERVICE ROLE key
-- (which bypasses RLS) to upload and download, and the frontend reads media only through the
-- "/api/whatsapp/media/:id" proxy. No public read policy is created on purpose.
--
-- If the INSERT into storage.buckets fails due to permissions, create the bucket
-- "whatsapp-media" manually in the Supabase Dashboard (Private, ~100MB limit).

INSERT INTO storage.buckets (id, name, public, file_size_limit)
VALUES (
  'whatsapp-media',
  'whatsapp-media',
  false,
  104857600  -- 100 MB, comfortably covers WhatsApp image/audio/video/document limits
)
ON CONFLICT (id) DO UPDATE SET
  public = excluded.public,
  file_size_limit = excluded.file_size_limit;

-- Service role bypasses RLS, so no policies are required for backend read/write.
-- Defensive cleanup in case a previous public policy was created for this bucket.
DROP POLICY IF EXISTS "whatsapp-media public read" ON storage.objects;
