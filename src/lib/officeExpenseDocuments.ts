import { supabase } from './supabase';
import { toast } from 'react-hot-toast';
import { FIRM_INVOICE_DOCUMENTS_BUCKET } from './firmInvoiceDocuments';
import {
  FIRM_MANAGEMENT_PAYMENT_CONFIRMATIONS_BUCKET,
  FIRM_MANAGEMENT_TAX_RECEIPTS_BUCKET,
  fileNameFromStoragePath,
  guessMimeTypeFromFileName,
} from './firmManagementCostDocuments';

export type OfficeExpenseDocColumn = 'invoice' | 'payment_confirmation' | 'tax_receipt';

const PATH_SAFE = /^[a-zA-Z0-9._\-+()\s]*$/;

function sanitizeSegment(seg: string, maxLen = 120): string {
  const trimmed = seg.trim().slice(0, maxLen) || '_';
  if (PATH_SAFE.test(trimmed)) return trimmed;
  return trimmed.replace(/[^\w.\-()+]/g, '_').slice(0, maxLen) || '_';
}

export function bucketForOfficeExpenseDocColumn(column: OfficeExpenseDocColumn): string {
  switch (column) {
    case 'invoice':
      return FIRM_INVOICE_DOCUMENTS_BUCKET;
    case 'payment_confirmation':
      return FIRM_MANAGEMENT_PAYMENT_CONFIRMATIONS_BUCKET;
    case 'tax_receipt':
      return FIRM_MANAGEMENT_TAX_RECEIPTS_BUCKET;
  }
}

/** Object path: office-expenses/<rowId>/<column>/<timestamp>_<filename> */
export function buildOfficeExpenseStoragePath(
  expenseRowId: string,
  column: OfficeExpenseDocColumn,
  originalFileName: string,
): string {
  const safeBase = originalFileName.replace(/[^\w.\-()+\s]/g, '_').slice(0, 200) || 'file';
  return `office-expenses/${sanitizeSegment(expenseRowId, 80)}/${column}/${Date.now()}_${safeBase}`;
}

export { fileNameFromStoragePath };

async function removeStorageObject(bucket: string, path: string): Promise<void> {
  const trimmed = path.trim();
  if (!trimmed) return;
  const { error } = await supabase.storage.from(bucket).remove([trimmed]);
  if (error) throw error;
}

export async function uploadOfficeExpenseDocument(
  expenseRowId: string,
  column: OfficeExpenseDocColumn,
  file: File,
): Promise<string> {
  if (!expenseRowId?.trim()) {
    throw new Error('Save this office expense entry before uploading a document');
  }

  const bucket = bucketForOfficeExpenseDocColumn(column);
  const { data: existing, error: fetchErr } = await supabase
    .from('office_expenses')
    .select(column)
    .eq('id', expenseRowId)
    .single();
  if (fetchErr) throw fetchErr;

  const oldPath =
    typeof (existing as Record<string, unknown> | null)?.[column] === 'string'
      ? String((existing as Record<string, unknown>)[column]).trim()
      : '';

  const path = buildOfficeExpenseStoragePath(expenseRowId, column, file.name);
  const { error: upErr } = await supabase.storage
    .from(bucket)
    .upload(path, file, {
      contentType: file.type || guessMimeTypeFromFileName(file.name),
      upsert: true,
    });
  if (upErr) throw upErr;

  const { error: uErr } = await supabase
    .from('office_expenses')
    .update({ [column]: path })
    .eq('id', expenseRowId);
  if (uErr) throw uErr;

  if (oldPath && oldPath !== path) {
    try {
      await removeStorageObject(bucket, oldPath);
    } catch (err) {
      console.warn('Could not remove previous office expense document', err);
    }
  }

  return path;
}

export async function removeOfficeExpenseDocument(
  expenseRowId: string,
  column: OfficeExpenseDocColumn,
): Promise<void> {
  if (!expenseRowId?.trim()) return;

  const bucket = bucketForOfficeExpenseDocColumn(column);
  const { data: row, error: fetchErr } = await supabase
    .from('office_expenses')
    .select(column)
    .eq('id', expenseRowId)
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
    .from('office_expenses')
    .update({ [column]: null })
    .eq('id', expenseRowId);
  if (error) throw error;
}

export async function openOfficeExpenseDocument(
  column: OfficeExpenseDocColumn,
  storagePath: string | null | undefined,
): Promise<void> {
  if (!storagePath?.trim()) {
    toast.error('No document uploaded');
    return;
  }
  const bucket = bucketForOfficeExpenseDocColumn(column);
  const { data, error } = await supabase.storage
    .from(bucket)
    .createSignedUrl(storagePath.trim(), 3600);
  if (error || !data?.signedUrl) {
    toast.error('Could not open file');
    return;
  }
  window.open(data.signedUrl, '_blank', 'noopener,noreferrer');
}
