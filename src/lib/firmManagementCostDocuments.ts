import { supabase } from './supabase';
import { toast } from 'react-hot-toast';
import { fileNameFromStoragePath } from './firmColumnDocuments';

/** Matches `sql/create_firm_management_cost_document_buckets.sql` */
export const FIRM_MANAGEMENT_PAYMENT_CONFIRMATIONS_BUCKET =
  'firm-management-payment-confirmations' as const;

export const FIRM_MANAGEMENT_TAX_RECEIPTS_BUCKET = 'firm-management-tax-receipts' as const;

export type FirmManagementCostDocColumn = 'payment_confirmation' | 'tax_receipt';

const PATH_SAFE = /^[a-zA-Z0-9._\-+()\s]*$/;

function sanitizeSegment(seg: string, maxLen = 120): string {
  const trimmed = seg.trim().slice(0, maxLen) || '_';
  if (PATH_SAFE.test(trimmed)) return trimmed;
  return trimmed.replace(/[^\w.\-()+]/g, '_').slice(0, maxLen) || '_';
}

export function bucketForManagementCostDocColumn(
  column: FirmManagementCostDocColumn,
): string {
  switch (column) {
    case 'payment_confirmation':
      return FIRM_MANAGEMENT_PAYMENT_CONFIRMATIONS_BUCKET;
    case 'tax_receipt':
      return FIRM_MANAGEMENT_TAX_RECEIPTS_BUCKET;
  }
}

/** Object path: costs/<costRowId>/<column>/<timestamp>_<filename> */
export function buildFirmManagementCostStoragePath(
  costRowId: string,
  column: FirmManagementCostDocColumn,
  originalFileName: string,
): string {
  const safeBase = originalFileName.replace(/[^\w.\-()+\s]/g, '_').slice(0, 200) || 'file';
  return `costs/${sanitizeSegment(costRowId, 80)}/${column}/${Date.now()}_${safeBase}`;
}

export { fileNameFromStoragePath };

export function guessMimeTypeFromFileName(fileName: string): string {
  const ext = fileName.split('.').pop()?.toLowerCase() ?? '';
  const map: Record<string, string> = {
    pdf: 'application/pdf',
    png: 'image/png',
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    webp: 'image/webp',
    gif: 'image/gif',
    doc: 'application/msword',
    docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    xls: 'application/vnd.ms-excel',
    xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  };
  return map[ext] || 'application/octet-stream';
}

async function removeStorageObject(bucket: string, path: string): Promise<void> {
  const trimmed = path.trim();
  if (!trimmed) return;
  const { error } = await supabase.storage.from(bucket).remove([trimmed]);
  if (error) throw error;
}

export async function uploadFirmManagementCostDocument(
  costRowId: string,
  column: FirmManagementCostDocColumn,
  file: File,
): Promise<string> {
  if (!costRowId?.trim()) {
    throw new Error('Save this management cost entry before uploading a document');
  }

  const bucket = bucketForManagementCostDocColumn(column);
  const { data: existing, error: fetchErr } = await supabase
    .from('firm_management_costs')
    .select(column)
    .eq('id', costRowId)
    .single();
  if (fetchErr) throw fetchErr;

  const oldPath =
    typeof (existing as Record<string, unknown> | null)?.[column] === 'string'
      ? String((existing as Record<string, unknown>)[column]).trim()
      : '';

  const path = buildFirmManagementCostStoragePath(costRowId, column, file.name);
  const { error: upErr } = await supabase.storage
    .from(bucket)
    .upload(path, file, { contentType: file.type || undefined, upsert: true });
  if (upErr) throw upErr;

  const { error: uErr } = await supabase
    .from('firm_management_costs')
    .update({ [column]: path })
    .eq('id', costRowId);
  if (uErr) throw uErr;

  if (oldPath && oldPath !== path) {
    try {
      await removeStorageObject(bucket, oldPath);
    } catch (err) {
      console.warn('Could not remove previous management cost document', err);
    }
  }

  return path;
}

export async function removeFirmManagementCostDocument(
  costRowId: string,
  column: FirmManagementCostDocColumn,
): Promise<void> {
  if (!costRowId?.trim()) return;

  const bucket = bucketForManagementCostDocColumn(column);
  const { data: row, error: fetchErr } = await supabase
    .from('firm_management_costs')
    .select(column)
    .eq('id', costRowId)
    .single();
  if (fetchErr) throw fetchErr;

  const path =
    typeof (row as Record<string, unknown> | null)?.[column] === 'string'
      ? String((row as Record<string, unknown>)[column]).trim()
      : '';

  if (path) {
    await removeStorageObject(bucket, path);
  }

  const { error } = await supabase
    .from('firm_management_costs')
    .update({ [column]: null })
    .eq('id', costRowId);
  if (error) throw error;
}

export async function openFirmManagementCostDocument(
  column: FirmManagementCostDocColumn,
  storagePath: string | null | undefined,
): Promise<void> {
  if (!storagePath?.trim()) {
    toast.error('No document uploaded');
    return;
  }
  const bucket = bucketForManagementCostDocColumn(column);
  const { data, error } = await supabase.storage
    .from(bucket)
    .createSignedUrl(storagePath.trim(), 3600);
  if (error || !data?.signedUrl) {
    toast.error('Could not open file');
    return;
  }
  window.open(data.signedUrl, '_blank', 'noopener,noreferrer');
}
