/** Same bucket as `SubEffortsLogModal` (see `sql/create_lead_sub_efforts_documents_bucket.sql`). */
export const CASE_DOCUMENTS_STORAGE_BUCKET = 'lead-sub-efforts-documents' as const;

/** Signed URLs for previews and downloads in the case-document modal. */
export const CASE_DOCUMENTS_SIGNED_URL_SECONDS = 60 * 60 * 24; // 24h

/** Extension → MIME for uploads when the browser reports empty / octet-stream. */
const CASE_DOCUMENT_MIME_BY_EXT: Record<string, string> = {
  pdf: 'application/pdf',
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  heic: 'image/heic',
  heif: 'image/heif',
  doc: 'application/msword',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xls: 'application/vnd.ms-excel',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  csv: 'text/csv',
  ppt: 'application/vnd.ms-powerpoint',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  txt: 'text/plain',
  rtf: 'application/rtf',
  zip: 'application/zip',
  rar: 'application/vnd.rar',
  '7z': 'application/x-7z-compressed',
  numbers: 'application/vnd.apple.numbers',
  pages: 'application/vnd.apple.pages',
  key: 'application/vnd.apple.keynote',
  odt: 'application/vnd.oasis.opendocument.text',
  ods: 'application/vnd.oasis.opendocument.spreadsheet',
  mp4: 'video/mp4',
  mov: 'video/quicktime',
  m4a: 'audio/mp4',
  mp3: 'audio/mpeg',
};

const WEAK_BROWSER_MIME_TYPES = new Set(['', 'application/octet-stream', 'binary/octet-stream']);

export function guessCaseDocumentMimeTypeFromFileName(fileName: string): string {
  const ext = fileName.split('.').pop()?.toLowerCase() ?? '';
  return CASE_DOCUMENT_MIME_BY_EXT[ext] || 'application/octet-stream';
}

/** Prefer a concrete MIME for Storage uploads (bucket rejects bare octet-stream for unknown files). */
export function resolveCaseDocumentUploadContentType(file: File): string {
  const browserType = file.type?.trim().toLowerCase() ?? '';
  if (browserType && !WEAK_BROWSER_MIME_TYPES.has(browserType)) {
    return browserType;
  }
  return guessCaseDocumentMimeTypeFromFileName(file.name);
}

const PATH_SAFE = /^[a-zA-Z0-9._\-+()\s]*$/;

function sanitizeSegment(seg: string, maxLen = 140): string {
  const trimmed = seg.trim().slice(0, maxLen) || '_';
  if (PATH_SAFE.test(trimmed)) return trimmed;
  return trimmed.replace(/[^\w.\-()+]/g, '_').slice(0, maxLen) || '_';
}

/**
 * Object path inside the bucket (no leading slash).
 * Separate from sub-efforts paths (`sub-efforts/...`).
 */
export function buildCaseDocumentStoragePath(
  leadNumber: string,
  logicalSubfolder: string | null | undefined,
  originalFileName: string,
): string {
  const leadSeg = sanitizeSegment(leadNumber, 120);
  const subSeg = logicalSubfolder?.trim() ? sanitizeSegment(logicalSubfolder.trim(), 80) : '_root';
  const safeBase = originalFileName.replace(/[^\w.\-()+\s]/g, '_');
  return `case-documents/${leadSeg}/${subSeg}/${Date.now()}_${safeBase}`;
}

/** Staff internal meetings (no lead) — separate prefix from case / sub-effort paths. */
export function buildStaffMeetingDocumentStoragePath(meetingId: number, originalFileName: string): string {
  const meetingSeg = sanitizeSegment(String(meetingId), 40);
  const safeBase = originalFileName.replace(/[^\w.\-()+\s]/g, '_');
  return `staff-meetings/${meetingSeg}/${Date.now()}_${safeBase}`;
}
