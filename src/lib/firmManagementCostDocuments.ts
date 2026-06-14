import { supabase } from './supabase';
import { toast } from 'react-hot-toast';
import { fileNameFromStoragePath } from './firmColumnDocuments';
import { applyMonthAnchorFilter, managementCostLineKey, toBillingMonthStart } from './firmManagementCosts';

/** Matches `sql/create_firm_management_cost_document_buckets.sql` */
export const FIRM_MANAGEMENT_PAYMENT_CONFIRMATIONS_BUCKET =
  'firm-management-payment-confirmations' as const;

export const FIRM_MANAGEMENT_TAX_RECEIPTS_BUCKET = 'firm-management-tax-receipts' as const;

export type FirmManagementCostDocColumn = 'payment_confirmation' | 'tax_receipt';

export type FirmManagementCostDocument = {
  id: string;
  firm_id: string;
  billing_month: string;
  firm_management_cost_id?: string | null;
  doc_type: FirmManagementCostDocColumn;
  storage_path: string | null;
  file_name: string | null;
  mime_type: string | null;
  created_at?: string | null;
};

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

export const managementCostDocumentKey = (firmId: string, month: unknown): string => {
  const anchor = toBillingMonthStart(month) || String(month ?? '').trim().slice(0, 10);
  return `${firmId}|${anchor}`;
};

/** @deprecated Prefer managementCostLineKey from firmManagementCosts */
export { managementCostLineKey };

/** Object path: costs/<firmId>/<billingMonth>/<docType>/<docId>/<timestamp>_<filename> */
export function buildFirmManagementCostStoragePath(
  firmId: string,
  billingMonth: unknown,
  column: FirmManagementCostDocColumn,
  documentRowId: string,
  originalFileName: string,
): string {
  const month = toBillingMonthStart(billingMonth) || 'unknown-month';
  const safeBase = originalFileName.replace(/[^\w.\-()+\s]/g, '_').slice(0, 200) || 'file';
  return `costs/${sanitizeSegment(firmId, 80)}/${sanitizeSegment(month, 20)}/${column}/${sanitizeSegment(documentRowId, 80)}/${Date.now()}_${safeBase}`;
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

const DOC_SELECT =
  'id, firm_id, billing_month, firm_management_cost_id, doc_type, storage_path, file_name, mime_type, created_at';

async function removeStorageObject(bucket: string, path: string): Promise<void> {
  const trimmed = path.trim();
  if (!trimmed) return;
  const { error } = await supabase.storage.from(bucket).remove([trimmed]);
  if (error) throw error;
}

export async function fetchDocumentsForCostLine(
  costId: string,
  docType: FirmManagementCostDocColumn,
  firmId?: string,
  billingMonth?: unknown,
): Promise<FirmManagementCostDocument[]> {
  if (!costId?.trim()) {
    return fetchDocumentsForFirmMonth(firmId || '', billingMonth, docType);
  }

  const { data, error } = await supabase
    .from('firm_management_cost_documents')
    .select(DOC_SELECT)
    .eq('firm_management_cost_id', costId)
    .eq('doc_type', docType)
    .order('created_at', { ascending: false });

  if (error) throw error;
  return (data || []) as FirmManagementCostDocument[];
}

export async function fetchDocumentsForFirmMonth(
  firmId: string,
  billingMonth: unknown,
  docType: FirmManagementCostDocColumn,
): Promise<FirmManagementCostDocument[]> {
  const billing_month = toBillingMonthStart(billingMonth);
  if (!firmId || !billing_month) return [];

  const { data, error } = await supabase
    .from('firm_management_cost_documents')
    .select(DOC_SELECT)
    .eq('firm_id', firmId)
    .eq('billing_month', billing_month)
    .eq('doc_type', docType)
    .order('created_at', { ascending: false });

  if (error) throw error;
  return (data || []) as FirmManagementCostDocument[];
}

/** firm_id + billing_month → document rows grouped by doc_type (for table columns). */
export async function fetchFirmManagementCostDocumentsIndex(
  month: string,
  year: string,
): Promise<{
  paymentByKey: Map<string, FirmManagementCostDocument[]>;
  taxByKey: Map<string, FirmManagementCostDocument[]>;
}> {
  let q = supabase.from('firm_management_cost_documents').select(DOC_SELECT);
  q = applyMonthAnchorFilter(q, 'billing_month', month, year);
  const { data, error } = await q;
  if (error) throw error;

  const paymentByKey = new Map<string, FirmManagementCostDocument[]>();
  const taxByKey = new Map<string, FirmManagementCostDocument[]>();

  (data || []).forEach((row: FirmManagementCostDocument) => {
    const key = managementCostLineKey(row.firm_management_cost_id, row.firm_id, row.billing_month);
    const target = row.doc_type === 'tax_receipt' ? taxByKey : paymentByKey;
    const list = target.get(key) || [];
    list.push(row);
    target.set(key, list);
  });

  return { paymentByKey, taxByKey };
}

export async function uploadFirmManagementCostDocument(
  firmId: string,
  billingMonth: unknown,
  column: FirmManagementCostDocColumn,
  file: File,
  firmManagementCostId?: string | null,
): Promise<FirmManagementCostDocument> {
  const billing_month = toBillingMonthStart(billingMonth);
  if (!firmId?.trim() || !billing_month) {
    throw new Error('Select firm and billing month before uploading a document');
  }

  const bucket = bucketForManagementCostDocColumn(column);

  const { data: inserted, error: insErr } = await supabase
    .from('firm_management_cost_documents')
    .insert([
      {
        firm_id: firmId,
        billing_month,
        firm_management_cost_id: firmManagementCostId?.trim() || null,
        doc_type: column,
        storage_path: '',
        file_name: file.name,
        mime_type: file.type || guessMimeTypeFromFileName(file.name),
      },
    ])
    .select(DOC_SELECT)
    .single();

  if (insErr) throw insErr;

  const path = buildFirmManagementCostStoragePath(
    firmId,
    billing_month,
    column,
    inserted.id,
    file.name,
  );

  const { error: upErr } = await supabase.storage
    .from(bucket)
    .upload(path, file, {
      contentType: file.type || guessMimeTypeFromFileName(file.name),
      upsert: true,
    });
  if (upErr) throw upErr;

  const { data: updated, error: uErr } = await supabase
    .from('firm_management_cost_documents')
    .update({ storage_path: path, file_name: file.name })
    .eq('id', inserted.id)
    .select(DOC_SELECT)
    .single();

  if (uErr) throw uErr;
  return updated as FirmManagementCostDocument;
}

export async function removeFirmManagementCostDocument(
  document: Pick<FirmManagementCostDocument, 'id' | 'doc_type' | 'storage_path'>,
): Promise<void> {
  const bucket = bucketForManagementCostDocColumn(document.doc_type);
  const path = document.storage_path?.trim();
  if (path) {
    await removeStorageObject(bucket, path);
  }

  const { error } = await supabase
    .from('firm_management_cost_documents')
    .delete()
    .eq('id', document.id);
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
