import type { DocumentViewerItem } from '../components/DocumentViewerModal';
import {
  fetchFinanceExpenseDocumentsForEntries,
  signFinanceExpenseDocuments,
  type FinanceExpenseDocumentRow,
  type FinanceExpenseDocumentType,
} from './financeExpenseDocuments';
import { supabase } from './supabase';

export type ProformaExpenseDocSource =
  | { type: 'new'; paymentPlanId: string | number }
  | { type: 'legacy'; pprId: string | number | null | undefined }
  | { type: 'public-new'; paymentPlanId: string | number; token: string }
  | { type: 'public-legacy'; proformaId: string | number; token: string };

function parseDocRows(raw: unknown): FinanceExpenseDocumentRow[] {
  let list: unknown = raw;
  if (typeof raw === 'string') {
    try {
      list = JSON.parse(raw);
    } catch {
      return [];
    }
  }
  if (!Array.isArray(list)) return [];
  return list
    .map((row: any) => {
      const id = Number(row?.id);
      const entryId = Number(row?.entry_id);
      const storagePath = String(row?.storage_path || '').trim();
      if (!Number.isFinite(id) || !storagePath) return null;
      const documentType = String(row?.document_type || 'invoice') as FinanceExpenseDocumentType;
      return {
        id,
        entry_id: Number.isFinite(entryId) ? entryId : 0,
        document_type: documentType === 'receipt' || documentType === 'other' ? documentType : 'invoice',
        file_name: String(row?.file_name || 'file'),
        mime_type: row?.mime_type != null ? String(row.mime_type) : null,
        storage_path: storagePath,
        created_at: String(row?.created_at || ''),
      } satisfies FinanceExpenseDocumentRow;
    })
    .filter((row): row is FinanceExpenseDocumentRow => Boolean(row));
}

async function fetchAuthenticatedPaymentRowExpenseDocuments(
  paymentPlanColumn: 'payment_plan_id' | 'legacy_payment_plan_row_id',
  paymentRowId: string | number | null | undefined,
): Promise<FinanceExpenseDocumentRow[]> {
  const paymentId = Number(paymentRowId);
  if (!Number.isFinite(paymentId) || paymentId <= 0) return [];

  const { data: expenses, error } = await supabase
    .from('lead_expenses')
    .select('id')
    .eq(paymentPlanColumn, paymentId);
  if (error || !expenses?.length) return [];

  const destIds = expenses.map((row: { id: number }) => String(row.id)).filter(Boolean);
  const { data: entries } = await supabase
    .from('finance_expense_entries')
    .select('id')
    .eq('destination_table', 'lead_expenses')
    .in('destination_id', destIds)
    .eq('kind', 'lead');
  if (!entries?.length) return [];

  const entryIds = entries
    .map((row: { id: number }) => Number(row.id))
    .filter((id) => Number.isFinite(id) && id > 0);
  const byEntry = await fetchFinanceExpenseDocumentsForEntries(entryIds);
  return [...byEntry.values()].flat();
}

export function toProformaExpenseViewerItems(
  signed: Array<FinanceExpenseDocumentRow & { signedUrl: string }>,
): DocumentViewerItem[] {
  return signed.map((doc) => ({
    id: String(doc.id),
    name: doc.file_name,
    url: doc.signedUrl,
    fileType: doc.mime_type || undefined,
    lastModified: doc.created_at,
    storagePath: doc.storage_path,
  }));
}

export async function fetchSignedProformaExpenseDocuments(
  source: ProformaExpenseDocSource,
): Promise<Array<FinanceExpenseDocumentRow & { signedUrl: string }>> {
  let rows: FinanceExpenseDocumentRow[] = [];

  if (source.type === 'new') {
    rows = await fetchAuthenticatedPaymentRowExpenseDocuments(
      'payment_plan_id',
      source.paymentPlanId,
    );
  } else if (source.type === 'legacy') {
    rows = await fetchAuthenticatedPaymentRowExpenseDocuments(
      'legacy_payment_plan_row_id',
      source.pprId,
    );
  } else if (source.type === 'public-new') {
    const { data, error } = await supabase.rpc('get_public_new_proforma_expense_documents', {
      p_payment_plan_id: Number(source.paymentPlanId),
      p_public_token: source.token,
    });
    if (error) {
      console.warn('[proformaExpenseDocuments] public new:', error.message || error);
      return [];
    }
    rows = parseDocRows(data);
  } else {
    const { data, error } = await supabase.rpc('get_public_legacy_proforma_expense_documents', {
      p_proforma_id: Number(source.proformaId),
      p_public_token: source.token,
    });
    if (error) {
      console.warn('[proformaExpenseDocuments] public legacy:', error.message || error);
      return [];
    }
    rows = parseDocRows(data);
  }

  return signFinanceExpenseDocuments(rows);
}
