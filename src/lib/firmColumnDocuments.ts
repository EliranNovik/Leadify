import { supabase } from './supabase';
import { toast } from 'react-hot-toast';
import { FIRM_INVOICE_DOCUMENTS_BUCKET } from './firmInvoiceDocuments';

/** Matches `sql/create_firm_contracts_bucket.sql` */
export const FIRM_CONTRACTS_BUCKET = 'firm-contracts' as const;

/** Matches `sql/create_firms_other_documents_bucket.sql` */
export const FIRM_OTHER_DOCUMENTS_BUCKET = 'firms_other_documents' as const;

export type FirmDocumentColumn = 'contract' | 'contract_2' | 'invoices' | 'other_docs';

const PATH_SAFE = /^[a-zA-Z0-9._\-+()\s]*$/;

function sanitizeSegment(seg: string, maxLen = 120): string {
  const trimmed = seg.trim().slice(0, maxLen) || '_';
  if (PATH_SAFE.test(trimmed)) return trimmed;
  return trimmed.replace(/[^\w.\-()+]/g, '_').slice(0, maxLen) || '_';
}

export function bucketForFirmDocumentColumn(column: FirmDocumentColumn): string {
  switch (column) {
    case 'contract':
    case 'contract_2':
      return FIRM_CONTRACTS_BUCKET;
    case 'invoices':
      return FIRM_INVOICE_DOCUMENTS_BUCKET;
    case 'other_docs':
      return FIRM_OTHER_DOCUMENTS_BUCKET;
  }
}

/** Object path: firms/<firmId>/<column>/<timestamp>_<filename> */
export function buildFirmColumnStoragePath(
  firmId: string,
  column: FirmDocumentColumn,
  originalFileName: string,
): string {
  const safeBase = originalFileName.replace(/[^\w.\-()+\s]/g, '_').slice(0, 200) || 'file';
  return `firms/${sanitizeSegment(firmId, 80)}/${column}/${Date.now()}_${safeBase}`;
}

export function fileNameFromStoragePath(path: string | null | undefined): string {
  if (!path?.trim()) return '';
  const base = path.trim().split('/').pop() || path;
  const match = base.match(/^\d+_(.+)$/);
  return match ? match[1] : base;
}

async function removeStorageObject(bucket: string, path: string): Promise<void> {
  const trimmed = path.trim();
  if (!trimmed) return;
  const { error } = await supabase.storage.from(bucket).remove([trimmed]);
  if (error) throw error;
}

function readColumnPath(row: unknown, column: FirmDocumentColumn): string {
  if (!row || typeof row !== 'object') return '';
  const val = (row as Record<string, unknown>)[column];
  return typeof val === 'string' ? val.trim() : '';
}

export async function uploadFirmColumnDocument(
  firmId: string,
  column: FirmDocumentColumn,
  file: File,
): Promise<string> {
  if (!firmId?.trim()) {
    throw new Error('Save the firm before uploading a document');
  }

  const bucket = bucketForFirmDocumentColumn(column);
  const { data: existing, error: fetchErr } = await supabase
    .from('firms')
    .select(column)
    .eq('id', firmId)
    .single();
  if (fetchErr) throw fetchErr;

  const oldPath = readColumnPath(existing, column);
  const path = buildFirmColumnStoragePath(firmId, column, file.name);
  const { error: upErr } = await supabase.storage
    .from(bucket)
    .upload(path, file, { contentType: file.type || undefined, upsert: true });
  if (upErr) throw upErr;

  const { error: uErr } = await supabase.from('firms').update({ [column]: path }).eq('id', firmId);
  if (uErr) throw uErr;

  if (oldPath && oldPath !== path) {
    try {
      await removeStorageObject(bucket, oldPath);
    } catch (err) {
      console.warn('Could not remove previous firm document file', err);
    }
  }

  return path;
}

export async function removeFirmColumnDocument(
  firmId: string,
  column: FirmDocumentColumn,
): Promise<void> {
  if (!firmId?.trim()) return;

  const bucket = bucketForFirmDocumentColumn(column);
  const { data: row, error: fetchErr } = await supabase
    .from('firms')
    .select(column)
    .eq('id', firmId)
    .single();
  if (fetchErr) throw fetchErr;

  const path = readColumnPath(row, column);
  if (path) {
    await removeStorageObject(bucket, path);
  }

  const { error } = await supabase.from('firms').update({ [column]: null }).eq('id', firmId);
  if (error) throw error;
}

export async function openFirmColumnDocument(
  column: FirmDocumentColumn,
  storagePath: string | null | undefined,
): Promise<void> {
  if (!storagePath?.trim()) {
    toast.error('No document uploaded');
    return;
  }
  const bucket = bucketForFirmDocumentColumn(column);
  const { data, error } = await supabase.storage
    .from(bucket)
    .createSignedUrl(storagePath.trim(), 3600);
  if (error || !data?.signedUrl) {
    toast.error('Could not open file');
    return;
  }
  window.open(data.signedUrl, '_blank', 'noopener,noreferrer');
}
