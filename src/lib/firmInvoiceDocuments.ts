/** Matches `sql/create_firm_invoice_documents_bucket.sql` */
export const FIRM_INVOICE_DOCUMENTS_BUCKET = 'firm-invoice-documents' as const;

const PATH_SAFE = /^[a-zA-Z0-9._\-+()\s]*$/;

function sanitizeSegment(seg: string, maxLen = 120): string {
  const trimmed = seg.trim().slice(0, maxLen) || '_';
  if (PATH_SAFE.test(trimmed)) return trimmed;
  return trimmed.replace(/[^\w.\-()+]/g, '_').slice(0, maxLen) || '_';
}

/** Object path inside the bucket: firms/<firmId>/<invoiceRowId>/<filename> */
export function buildFirmInvoiceStoragePath(
  firmId: string,
  invoiceRowId: string,
  originalFileName: string,
): string {
  const safeBase = originalFileName.replace(/[^\w.\-()+\s]/g, '_').slice(0, 200) || 'file';
  return `firms/${sanitizeSegment(firmId, 80)}/${sanitizeSegment(invoiceRowId, 80)}/${Date.now()}_${safeBase}`;
}
