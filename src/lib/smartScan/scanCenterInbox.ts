import { buildBackendApiUrl, buildBackendApiUrlObject } from '../backendApiBase';
import {
  createStorageSignedUrlMap,
  EMAIL_ATTACHMENTS_STORAGE_BUCKET,
} from '../leadEmailAttachments';
import type { SmartScanItem } from './smartScanTypes';

export const SCAN_CENTER_EMAIL = 'scancenter@lawoffice.org.il';
export const SCAN_CENTER_SCANNER_NAME = 'Scan Center';

export type ScanCenterInboxResult = {
  items: SmartScanItem[];
  warning?: string;
  mailbox?: string;
};

type InboxApiItem = SmartScanItem & {
  storagePath?: string | null;
  contentType?: string | null;
  emailId?: number;
  attachmentId?: string;
  scanDocumentId?: string;
};

function previewApiUrl(emailId?: number, attachmentId?: string): string | undefined {
  if (!emailId || !attachmentId) return undefined;
  return buildBackendApiUrl(
    `/api/smart-scan/attachments/${encodeURIComponent(String(emailId))}/${encodeURIComponent(attachmentId)}`,
  );
}

function documentFileUrl(scanDocumentId?: string): string | undefined {
  if (!scanDocumentId) return undefined;
  return buildBackendApiUrl(`/api/smart-scan/documents/${encodeURIComponent(scanDocumentId)}/file`);
}

export function fullScanPreviewUrl(item: SmartScanItem): string | undefined {
  return (
    documentFileUrl(item.parentDocumentId) ||
    documentFileUrl(item.scanDocumentId) ||
    previewApiUrl(item.emailId, item.attachmentId) ||
    item.previewUrl
  );
}

export async function fetchScanCenterInbox(options?: { sync?: boolean }): Promise<ScanCenterInboxResult> {
  const url = buildBackendApiUrlObject('/api/smart-scan/inbox');
  url.searchParams.set('_', String(Date.now()));
  url.searchParams.set('sync', options?.sync ? '1' : '0');
  const response = await fetch(url.toString(), { cache: 'no-store' });
  const payload = await response.json().catch(() => null);
  if (!response.ok || payload?.success === false) {
    throw new Error(payload?.error || 'Failed to load Scan Center documents');
  }

  const rawItems: InboxApiItem[] = Array.isArray(payload?.items) ? payload.items : [];
  const paths = rawItems.map((item) => String(item.storagePath || '').trim()).filter(Boolean);
  const signed = await createStorageSignedUrlMap(EMAIL_ATTACHMENTS_STORAGE_BUCKET, paths);

  const items: SmartScanItem[] = rawItems.map((item) => {
    const storagePath = String(item.storagePath || '').trim();
    const previewUrl =
      (storagePath && signed.get(storagePath)) ||
      documentFileUrl(item.scanDocumentId) ||
      previewApiUrl(item.emailId, item.attachmentId);
    return {
      ...item,
      previewUrl,
      storagePath: storagePath || undefined,
      contentType: item.contentType || undefined,
    };
  });

  const warning = typeof payload?.warning === 'string' && payload.warning.trim() ? payload.warning.trim() : undefined;
  return { items, warning, mailbox: payload?.mailbox || SCAN_CENTER_EMAIL };
}

export async function requestScanCenterSync(): Promise<void> {
  const url = buildBackendApiUrlObject('/api/smart-scan/sync');
  await fetch(url.toString(), { method: 'POST', cache: 'no-store' }).catch(() => undefined);
}

export async function processScanCenterItem(id: string): Promise<void> {
  const url = buildBackendApiUrlObject('/api/smart-scan/process');
  const response = await fetch(url.toString(), {
    method: 'POST',
    cache: 'no-store',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ id }),
  });
  const payload = await response.json().catch(() => null);
  if (!response.ok || payload?.success === false) {
    throw new Error(payload?.error || 'Failed to process scanned document');
  }
}

export async function assignScanCenterLead(id: string, lead: SmartScanItem['lead']): Promise<void> {
  const url = buildBackendApiUrlObject('/api/smart-scan/assign');
  const response = await fetch(url.toString(), {
    method: 'POST',
    cache: 'no-store',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ id, lead }),
  });
  const payload = await response.json().catch(() => null);
  if (!response.ok || payload?.success === false) {
    throw new Error(payload?.error || 'Failed to assign scanned document');
  }
}

export async function splitScanCaseDocument(caseDocumentId: string): Promise<{ count: number }> {
  const url = buildBackendApiUrlObject('/api/smart-scan/split-case-document');
  const response = await fetch(url.toString(), {
    method: 'POST',
    cache: 'no-store',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ caseDocumentId }),
  });
  const payload = await response.json().catch(() => null);
  if (!response.ok || payload?.success === false) {
    throw new Error(payload?.error || 'Failed to separate scan into documents');
  }
  return { count: Number(payload?.count) || 0 };
}

export async function approveScanCenterItem(id: string): Promise<void> {
  const url = buildBackendApiUrlObject('/api/smart-scan/approve');
  const response = await fetch(url.toString(), {
    method: 'POST',
    cache: 'no-store',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ id }),
  });
  const payload = await response.json().catch(() => null);
  if (!response.ok || payload?.success === false) {
    throw new Error(payload?.error || 'Failed to approve scanned document');
  }
}

export async function removeScanCenterItem(id: string): Promise<{ attachmentId?: string }> {
  const url = buildBackendApiUrlObject('/api/smart-scan/remove');
  const response = await fetch(url.toString(), {
    method: 'POST',
    cache: 'no-store',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ id }),
  });
  const payload = await response.json().catch(() => null);
  if (!response.ok || payload?.success === false) {
    throw new Error(payload?.error || 'Failed to remove scanned document');
  }
  return { attachmentId: typeof payload?.attachmentId === 'string' ? payload.attachmentId : undefined };
}
