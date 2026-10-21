-- Allow SVG drawings and saved Outlook messages in the case documents bucket.
--
-- An SVG failed to upload because the browser reports the concrete type image/svg+xml, which the
-- app therefore keeps rather than falling back to octet-stream, and that type was not on the
-- allowlist, so Storage answered 415 invalid_mime_type. Outlook .msg (and .eml, which comes from
-- the same place) are added at the same time.
--
-- Restates the whole list from 2026-06-23_lead_case_documents_widen_mime_types.sql, so this file
-- is the current state of the bucket on its own. Safe to re-run.

UPDATE storage.buckets
SET allowed_mime_types = ARRAY[
  'image/jpeg',
  'image/jpg',
  'image/png',
  'image/gif',
  'image/webp',
  'image/heic',
  'image/heif',
  'image/svg+xml',
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  'application/vnd.ms-powerpoint',
  'application/vnd.apple.numbers',
  'application/vnd.apple.pages',
  'application/vnd.apple.keynote',
  'application/vnd.oasis.opendocument.text',
  'application/vnd.oasis.opendocument.spreadsheet',
  'application/rtf',
  'text/plain',
  'text/csv',
  -- Saved Outlook items: .msg reports vnd.ms-outlook, .eml reports message/rfc822.
  'application/vnd.ms-outlook',
  'message/rfc822',
  'application/zip',
  'application/x-zip-compressed',
  'application/vnd.rar',
  'application/x-7z-compressed',
  'video/mp4',
  'video/quicktime',
  'audio/mp4',
  'audio/mpeg',
  'application/octet-stream'
]
WHERE id = 'lead-sub-efforts-documents';

SELECT id, file_size_limit, array_length(allowed_mime_types, 1) AS mime_types
FROM storage.buckets
WHERE id = 'lead-sub-efforts-documents';
