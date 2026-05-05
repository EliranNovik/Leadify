/** Same bucket as `SubEffortsLogModal` (see `sql/create_lead_sub_efforts_documents_bucket.sql`). */
export const CASE_DOCUMENTS_STORAGE_BUCKET = 'lead-sub-efforts-documents' as const;

/** Signed URLs for previews and downloads in the case-document modal. */
export const CASE_DOCUMENTS_SIGNED_URL_SECONDS = 60 * 60 * 24; // 24h

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
