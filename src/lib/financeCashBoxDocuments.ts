import { supabase } from './supabase';
import {
  guessMimeTypeFromFileName,
  validateFinanceExpenseDocumentFile,
} from './financeExpenseDocuments';

export const FINANCE_CASH_BOX_DOCUMENTS_BUCKET = 'finance-cash-box-documents';
export const CASH_BOX_DOCUMENT_MAX_FILES = 10;

export type CashBoxDocument = {
  id: number;
  transaction_id: string;
  file_name: string;
  mime_type: string | null;
  storage_path: string;
  created_at: string;
};

function safeName(name: string): string {
  return name.replace(/[^\w.\-()+\s]/g, '_').slice(0, 200) || 'file';
}

export async function uploadCashBoxDocuments(transactionId: string, files: File[]): Promise<void> {
  if (!transactionId || !files.length) return;
  const { data: { user } } = await supabase.auth.getUser();
  for (const file of files.slice(0, CASH_BOX_DOCUMENT_MAX_FILES)) {
    const validation = validateFinanceExpenseDocumentFile(file);
    if (validation) throw new Error(validation);
    const mime = file.type || guessMimeTypeFromFileName(file.name);
    const path = `transactions/${transactionId}/${Date.now()}_${safeName(file.name)}`;
    const { error: uploadError } = await supabase.storage
      .from(FINANCE_CASH_BOX_DOCUMENTS_BUCKET)
      .upload(path, file, { contentType: mime, upsert: false });
    if (uploadError) throw uploadError;
    const { error: rowError } = await supabase.from('finance_cash_box_documents').insert({
      transaction_id: transactionId,
      file_name: file.name,
      mime_type: mime,
      storage_path: path,
      uploaded_by: user?.id || null,
    });
    if (rowError) {
      await supabase.storage.from(FINANCE_CASH_BOX_DOCUMENTS_BUCKET).remove([path]);
      throw rowError;
    }
  }
}

export async function fetchCashBoxDocuments(
  transactionIds: string[],
): Promise<Map<string, CashBoxDocument[]>> {
  const map = new Map<string, CashBoxDocument[]>();
  if (!transactionIds.length) return map;
  const { data, error } = await supabase
    .from('finance_cash_box_documents')
    .select('id, transaction_id, file_name, mime_type, storage_path, created_at')
    .in('transaction_id', transactionIds)
    .order('created_at', { ascending: true });
  if (error) throw error;
  (data || []).forEach((row: any) => {
    const id = String(row.transaction_id);
    const list = map.get(id) || [];
    list.push({
      id: Number(row.id),
      transaction_id: id,
      file_name: String(row.file_name || 'file'),
      mime_type: row.mime_type ? String(row.mime_type) : null,
      storage_path: String(row.storage_path),
      created_at: String(row.created_at),
    });
    map.set(id, list);
  });
  return map;
}
