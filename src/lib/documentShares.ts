import { createStorageSignedUrlMap } from './leadEmailAttachments';
import { supabase } from './supabase';
import { buildBackendApiUrl } from './backendApiBase';

/** A document one employee sent another, as shown in the header bell's Shared tab. */
export type DocumentShareNotification = {
  id: string;
  documentName: string;
  documentType: string | null;
  contentType: string | null;
  storageBucket: string | null;
  storagePath: string | null;
  scanDocumentId: string | null;
  leadNumber: string | null;
  leadName: string | null;
  note: string | null;
  createdAt: string;
  sharedByEmployeeId: number;
  sharedByName: string;
  sharedByPhotoUrl: string | null;
};

export type DocumentShareInput = {
  documentName: string;
  documentType?: string | null;
  contentType?: string | null;
  storageBucket?: string | null;
  storagePath?: string | null;
  scanDocumentId?: string | null;
  leadNumber?: string | null;
  leadName?: string | null;
  note?: string | null;
  sharedByEmployeeId: number;
  sharedWithEmployeeId: number;
};

type ShareResult = { ok: true } | { ok: false; reason: 'self' | 'locator' | 'error'; message: string };

const trimmed = (value: unknown): string => String(value ?? '').trim();
const nullable = (value: unknown): string | null => trimmed(value) || null;

export async function createDocumentShare(input: DocumentShareInput): Promise<ShareResult> {
  const documentName = trimmed(input.documentName);
  const storagePath = nullable(input.storagePath);
  const scanDocumentId = nullable(input.scanDocumentId);

  if (input.sharedByEmployeeId === input.sharedWithEmployeeId) {
    return {
      ok: false,
      reason: 'self',
      message: 'You cannot share a document with yourself',
    };
  }
  // Mirrors the table's CHECK: a row that can't be resolved back to bytes is useless to the recipient.
  if (!storagePath && !scanDocumentId) {
    return {
      ok: false,
      reason: 'locator',
      message: 'This document has no file to share yet',
    };
  }

  const { error } = await supabase.from('document_shares').insert({
    document_name: documentName || 'Document',
    document_type: nullable(input.documentType),
    content_type: nullable(input.contentType),
    storage_bucket: nullable(input.storageBucket),
    storage_path: storagePath,
    scan_document_id: scanDocumentId,
    lead_number: nullable(input.leadNumber),
    lead_name: nullable(input.leadName),
    note: nullable(input.note),
    shared_by_employee_id: input.sharedByEmployeeId,
    shared_with_employee_id: input.sharedWithEmployeeId,
  });

  if (error) {
    console.error('Document share insert failed:', error);
    return { ok: false, reason: 'error', message: 'Could not share document' };
  }
  return { ok: true };
}

export type ShareTargetEmployee = {
  id: number;
  name: string;
  photoUrl: string | null;
};

/** Colleagues a document can be sent to, minus whoever is doing the sharing. */
export async function fetchShareTargets(excludeEmployeeId?: number | null): Promise<ShareTargetEmployee[]> {
  const { data, error } = await supabase
    .from('tenants_employee')
    .select('id, display_name, photo_url, photo')
    .order('display_name');

  if (error) {
    console.error('Error loading employees to share with:', error);
    return [];
  }

  return (data ?? [])
    .map((row) => ({
      id: Number(row.id),
      name: trimmed(row.display_name),
      photoUrl: trimmed(row.photo_url) || trimmed(row.photo) || null,
    }))
    .filter((emp) => Number.isFinite(emp.id) && emp.id > 0 && emp.name && emp.id !== excludeEmployeeId);
}

export async function fetchUnreadDocumentShares(employeeId: number): Promise<DocumentShareNotification[]> {
  if (!Number.isFinite(employeeId) || employeeId <= 0) return [];

  const { data, error } = await supabase
    .from('document_shares')
    .select(
      'id, document_name, document_type, content_type, storage_bucket, storage_path, scan_document_id, lead_number, lead_name, note, created_at, shared_by_employee_id',
    )
    .eq('shared_with_employee_id', employeeId)
    .is('read_at', null)
    .order('created_at', { ascending: false })
    .limit(50);

  if (error) {
    console.error('Error fetching document shares:', error);
    return [];
  }

  const rows = data ?? [];
  const sharerIds = [
    ...new Set(rows.map((row) => Number(row.shared_by_employee_id)).filter((id) => Number.isFinite(id) && id > 0)),
  ];

  const sharers = new Map<number, { name: string; photoUrl: string | null }>();
  if (sharerIds.length > 0) {
    const { data: employees } = await supabase
      .from('tenants_employee')
      .select('id, display_name, photo_url, photo')
      .in('id', sharerIds);
    for (const emp of employees ?? []) {
      sharers.set(Number(emp.id), {
        name: trimmed(emp.display_name) || 'Someone',
        photoUrl: trimmed(emp.photo_url) || trimmed(emp.photo) || null,
      });
    }
  }

  return rows.map((row) => {
    const sharer = sharers.get(Number(row.shared_by_employee_id));
    return {
      id: String(row.id),
      documentName: trimmed(row.document_name) || 'Document',
      documentType: nullable(row.document_type),
      contentType: nullable(row.content_type),
      storageBucket: nullable(row.storage_bucket),
      storagePath: nullable(row.storage_path),
      scanDocumentId: nullable(row.scan_document_id),
      leadNumber: nullable(row.lead_number),
      leadName: nullable(row.lead_name),
      note: nullable(row.note),
      createdAt: String(row.created_at ?? ''),
      sharedByEmployeeId: Number(row.shared_by_employee_id) || 0,
      sharedByName: sharer?.name ?? 'Someone',
      sharedByPhotoUrl: sharer?.photoUrl ?? null,
    };
  });
}

export async function markDocumentSharesRead(ids: string[]): Promise<void> {
  const unique = [...new Set(ids.map((id) => String(id).trim()).filter(Boolean))];
  if (unique.length === 0) return;
  const { error } = await supabase
    .from('document_shares')
    .update({ read_at: new Date().toISOString() })
    .in('id', unique)
    .is('read_at', null);
  if (error) {
    console.error('Error marking document shares as read:', error);
  }
}

/** The two ways to reach a shared document's bytes. Stored on the row and resolved on demand. */
export type DocumentShareLocator = {
  storageBucket: string | null;
  storagePath: string | null;
  scanDocumentId: string | null;
};

/**
 * Turns a locator into a URL that can be viewed, downloaded or attached.
 *
 * Storage comes first for two reasons: a signed URL keeps working after the scan leaves the Scan
 * Center queue, and it points at exactly one document — the Scan Center route falls back to the
 * whole parent scan for a split part that has no stored file of its own.
 */
export async function resolveDocumentShareUrl(locator: DocumentShareLocator): Promise<string | null> {
  if (locator.storageBucket && locator.storagePath) {
    const signed = await createStorageSignedUrlMap(locator.storageBucket, [locator.storagePath]);
    const url = signed.get(locator.storagePath);
    if (url) return url;
  }
  if (locator.scanDocumentId) {
    return buildBackendApiUrl(`/api/smart-scan/documents/${encodeURIComponent(locator.scanDocumentId)}/file`);
  }
  return null;
}
