export type SmartScanLeadMatchStatus = 'matched' | 'ambiguous' | 'unmatched';

export type SmartScanClassificationStatus =
  | 'classified'
  | 'needs_review'
  | 'failed'
  | 'processing';

export type SmartScanStatus =
  | 'received'
  | 'processing'
  | 'needs_review'
  | 'unmatched'
  | 'failed'
  | 'completed';

export type SmartScanIssue =
  | 'qr_not_found'
  | 'lead_not_found'
  | 'multiple_leads'
  | 'document_type_uncertain'
  | 'document_split_uncertain'
  | 'ocr_failed'
  | 'upload_failed'
  | 'duplicate_scan'
  | 'ai_processing_failed';

export type SmartScanLeadRef = {
  id?: string;
  leadNumber: string;
  name: string;
};

export type SmartScanActivityEntry = {
  at: string;
  label: string;
};

export type SmartScanItem = {
  id: string;
  batchId: string;
  createdAt: string;
  processedAt?: string;
  scannerName?: string;
  pageCount: number;
  leadMatchStatus: SmartScanLeadMatchStatus;
  leadAssignedBy?: 'ai' | 'user';
  classificationStatus: SmartScanClassificationStatus;
  lead?: SmartScanLeadRef;
  possibleLeadMatches?: SmartScanLeadRef[];
  documentType?: string;
  suggestedDocumentType?: string;
  title?: string;
  suggestedFilename?: string;
  detectedPersonName?: string;
  detectedCountry?: string;
  documentDate?: string;
  expiryDate?: string;
  summary?: string;
  confidence?: number;
  issue?: SmartScanIssue;
  originalFilename: string;
  status: SmartScanStatus;
  approvedBy?: string;
  approvedAt?: string;
  activity?: SmartScanActivityEntry[];
  ignored?: boolean;
  previewUrl?: string;
  storagePath?: string;
  contentType?: string;
  emailId?: number;
  attachmentId?: string;
  scanDocumentId?: string;
  parentDocumentId?: string;
  splitIndex?: number;
  splitCount?: number;
  pageStart?: number;
  pageEnd?: number;
};

export type SmartScanDatePreset = 'today' | '7d' | '30d' | 'custom' | 'all';

export type SmartScanSort = 'newest' | 'oldest';

export type SmartScanConfidenceBand = 'high' | 'medium' | 'low';

export type SmartScanQueue = 'matched' | 'unmatched' | 'processing' | 'history';

export type SmartScanTab = 'all' | SmartScanQueue;

export type SmartScanListFilters = {
  search?: string;
  datePreset?: SmartScanDatePreset;
  customFrom?: string;
  customTo?: string;
  scanner?: string;
  status?: SmartScanTab;
  sort?: SmartScanSort;
  documentType?: string;
  confidence?: SmartScanConfidenceBand | 'all';
};

export type SmartScanKpis = {
  scannedToday: number;
  matched: number;
  unmatched: number;
  processing: number;
  history: number;
};

export function scanQueueBucket(
  item: Pick<SmartScanItem, 'status' | 'lead' | 'leadMatchStatus' | 'leadAssignedBy'>,
): SmartScanQueue {
  if (item.status === 'processing') return 'processing';
  if (item.status === 'completed' || item.leadAssignedBy === 'user') return 'history';
  if (item.leadAssignedBy === 'ai' && item.leadMatchStatus === 'matched' && item.lead) return 'matched';
  return 'unmatched';
}

export const SMART_SCAN_DOCUMENT_TYPES = [
  'Passport',
  'Passport Copy',
  'ID Card Copy',
  'Birth Certificate',
  'Marriage Certificate',
  'Death Certificate',
  'Divorce Certificate',
  'Population Registry Extract',
  'Apostille',
  'Police Certificate',
  'Proof of Address',
  'Power of Attorney',
  'Contract',
  'Translation',
  'Naturalization Certificate',
  'Military Records',
  'Other',
  'Unknown',
] as const;

export const SMART_SCAN_SCANNERS = ['Scan Center'] as const;

export const SMART_SCAN_ISSUE_LABELS: Record<SmartScanIssue, string> = {
  qr_not_found: 'QR code could not be detected.',
  lead_not_found: 'Lead not found.',
  multiple_leads: 'Multiple possible leads matched.',
  document_type_uncertain: 'Document type uncertain.',
  document_split_uncertain: 'Document split uncertain.',
  ocr_failed: 'OCR failed.',
  upload_failed: 'Upload failed.',
  duplicate_scan: 'Duplicate scan.',
  ai_processing_failed: 'AI processing failed.',
};

export function confidenceBand(value?: number): SmartScanConfidenceBand | null {
  if (value == null || Number.isNaN(value)) return null;
  const pct = value <= 1 ? value * 100 : value;
  if (pct >= 90) return 'high';
  if (pct >= 70) return 'medium';
  return 'low';
}

export function confidencePercent(value?: number): number | null {
  if (value == null || Number.isNaN(value)) return null;
  const pct = value <= 1 ? value * 100 : value;
  return Math.round(pct);
}

export function buildSuggestedFilename(item: Pick<SmartScanItem, 'lead' | 'detectedPersonName' | 'documentType' | 'suggestedDocumentType' | 'documentDate'>): string {
  const leadNumber = (item.lead?.leadNumber || 'UNKNOWN').replace(/\//g, '-');
  const person = (item.detectedPersonName || item.lead?.name || 'Unknown')
    .trim()
    .replace(/\s+/g, '_');
  const type = (item.documentType || item.suggestedDocumentType || 'Document').replace(/\s+/g, '_');
  const date = (item.documentDate || '').slice(0, 10) || 'undated';
  return `${leadNumber}_${person}_${type}_${date}.pdf`;
}
