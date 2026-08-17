import { supabase } from './supabase';
import { toast } from 'react-hot-toast';

export const FINANCE_EXPENSE_DOCUMENTS_BUCKET = 'finance-expense-documents';
export const FINANCE_EXPENSE_DOC_MAX_BYTES = 15 * 1024 * 1024;
export const FINANCE_EXPENSE_DOC_MAX_FILES = 10;

export type FinanceExpenseDocumentType = 'invoice' | 'receipt' | 'other';

export const FINANCE_EXPENSE_DOCUMENT_TYPE_LABEL: Record<FinanceExpenseDocumentType, string> = {
  invoice: 'Invoice',
  receipt: 'Receipt',
  other: 'Other',
};

export type FinanceExpenseDocumentRow = {
  id: number;
  entry_id: number;
  document_type: FinanceExpenseDocumentType;
  file_name: string;
  mime_type: string | null;
  storage_path: string;
  created_at: string;
};

const ALLOWED_MIME = new Set([
  'image/jpeg',
  'image/jpg',
  'image/png',
  'image/gif',
  'image/webp',
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.ms-excel',
]);

function sanitizeFileName(name: string): string {
  return name.replace(/[^\w.\-()+\s]/g, '_').slice(0, 200) || 'file';
}

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

export function validateFinanceExpenseDocumentFile(file: File): string | null {
  if (file.size > FINANCE_EXPENSE_DOC_MAX_BYTES) {
    return `${file.name} is larger than 15 MB`;
  }
  const mime = file.type || guessMimeTypeFromFileName(file.name);
  if (file.type && !ALLOWED_MIME.has(file.type) && !ALLOWED_MIME.has(mime)) {
    return `${file.name} is not a supported file type (PDF, image, Word, Excel)`;
  }
  return null;
}

function storagePath(entryId: number, fileName: string): string {
  return `expenses/${entryId}/${Date.now()}_${sanitizeFileName(fileName)}`;
}

export async function uploadFinanceExpenseDocuments(
  entryId: number,
  files: Array<{ file: File; documentType: FinanceExpenseDocumentType }>,
): Promise<number> {
  if (!entryId || !files.length) return 0;
  const {
    data: { user },
  } = await supabase.auth.getUser();
  let uploaded = 0;

  for (const item of files) {
    const errMsg = validateFinanceExpenseDocumentFile(item.file);
    if (errMsg) {
      toast.error(errMsg);
      continue;
    }
    const path = storagePath(entryId, item.file.name);
    const mime = item.file.type || guessMimeTypeFromFileName(item.file.name);
    const { error: upErr } = await supabase.storage
      .from(FINANCE_EXPENSE_DOCUMENTS_BUCKET)
      .upload(path, item.file, { contentType: mime, upsert: false });
    if (upErr) {
      toast.error(`Could not upload ${item.file.name}`);
      console.warn('[financeExpenseDocuments] upload:', upErr);
      continue;
    }
    const { error: insErr } = await supabase.from('finance_expense_documents').insert({
      entry_id: entryId,
      document_type: item.documentType,
      file_name: item.file.name,
      mime_type: mime,
      storage_path: path,
      uploaded_by: user?.id || null,
    });
    if (insErr) {
      await supabase.storage.from(FINANCE_EXPENSE_DOCUMENTS_BUCKET).remove([path]);
      toast.error(`Could not save ${item.file.name}`);
      console.warn('[financeExpenseDocuments] insert:', insErr);
      continue;
    }
    uploaded += 1;
  }

  return uploaded;
}

export async function deleteFinanceExpenseDocumentsForEntry(entryId: number): Promise<void> {
  if (!entryId) return;
  const { data } = await supabase
    .from('finance_expense_documents')
    .select('storage_path')
    .eq('entry_id', entryId);
  const paths = (data || []).map((row: any) => String(row.storage_path || '')).filter(Boolean);
  if (paths.length) {
    await supabase.storage.from(FINANCE_EXPENSE_DOCUMENTS_BUCKET).remove(paths);
  }
  await supabase.from('finance_expense_documents').delete().eq('entry_id', entryId);
}

export async function fetchFinanceExpenseDocumentsForEntries(
  entryIds: number[],
): Promise<Map<number, FinanceExpenseDocumentRow[]>> {
  const map = new Map<number, FinanceExpenseDocumentRow[]>();
  if (!entryIds.length) return map;
  const { data, error } = await supabase
    .from('finance_expense_documents')
    .select('id, entry_id, document_type, file_name, mime_type, storage_path, created_at')
    .in('entry_id', entryIds)
    .order('created_at', { ascending: true });
  if (error) {
    console.warn('[financeExpenseDocuments] list:', error.message || error);
    return map;
  }
  (data || []).forEach((row: any) => {
    const entryId = Number(row.entry_id);
    const doc: FinanceExpenseDocumentRow = {
      id: Number(row.id),
      entry_id: entryId,
      document_type: row.document_type,
      file_name: String(row.file_name || 'file'),
      mime_type: row.mime_type != null ? String(row.mime_type) : null,
      storage_path: String(row.storage_path),
      created_at: String(row.created_at),
    };
    const list = map.get(entryId) || [];
    list.push(doc);
    map.set(entryId, list);
  });
  return map;
}

export async function getFinanceExpenseDocumentSignedUrl(storagePath: string): Promise<string | null> {
  if (!storagePath.trim()) return null;
  const { data, error } = await supabase.storage
    .from(FINANCE_EXPENSE_DOCUMENTS_BUCKET)
    .createSignedUrl(storagePath.trim(), 3600);
  if (error || !data?.signedUrl) {
    console.warn('[financeExpenseDocuments] signed url:', error);
    return null;
  }
  return data.signedUrl;
}

export async function signFinanceExpenseDocuments(
  docs: FinanceExpenseDocumentRow[],
): Promise<Array<FinanceExpenseDocumentRow & { signedUrl: string }>> {
  const signed = await Promise.all(
    docs.map(async (doc) => {
      const signedUrl = await getFinanceExpenseDocumentSignedUrl(doc.storage_path);
      return signedUrl ? { ...doc, signedUrl } : null;
    }),
  );
  return signed.filter((row): row is FinanceExpenseDocumentRow & { signedUrl: string } => Boolean(row));
}

export async function openFinanceExpenseDocument(storagePath: string): Promise<void> {
  const signedUrl = await getFinanceExpenseDocumentSignedUrl(storagePath);
  if (!signedUrl) {
    toast.error(storagePath.trim() ? 'Could not open file' : 'No document uploaded');
    return;
  }
  window.open(signedUrl, '_blank', 'noopener,noreferrer');
}
