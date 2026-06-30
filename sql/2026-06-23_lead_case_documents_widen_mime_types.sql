-- Widen lead-sub-efforts-documents bucket MIME allowlist (staff meetings + case docs share this bucket).
-- Fixes 415 invalid_mime_type for Apple Numbers/Pages/Keynote and other office types when browsers
-- send application/octet-stream.

UPDATE storage.buckets
SET allowed_mime_types = ARRAY[
  'image/jpeg',
  'image/jpg',
  'image/png',
  'image/gif',
  'image/webp',
  'image/heic',
  'image/heif',
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
