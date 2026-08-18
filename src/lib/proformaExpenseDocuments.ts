import type { DocumentViewerItem } from '../components/DocumentViewerModal';
import {
  fetchFinanceExpenseDocumentsForEntries,
  signFinanceExpenseDocuments,
  type FinanceExpenseDocumentRow,
  type FinanceExpenseDocumentType,
} from './financeExpenseDocuments';
import { supabase } from './supabase';

export type ProformaExpenseDocSource =
  | { type: 'new'; leadId: string | null | undefined }
  | { type: 'legacy'; leadId: number | string | null | undefined }
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

async function fetchAuthenticatedLeadExpenseDocuments(
  column: 'new_lead_id' | 'legacy_lead_id',
  leadId: string | number,
): Promise<FinanceExpenseDocumentRow[]> {
  const { data, error } = await supabase
    .from('finance_expense_entries')
    .select('id')
    .eq(column, leadId)
    .in('kind', ['lead', 'subcontractor']);
  if (error || !data?.length) return [];
  const entryIds = data.map((row: { id: number }) => Number(row.id)).filter((id) => Number.isFinite(id) && id > 0);
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
    const leadId = String(source.leadId || '').trim();
    if (!leadId) return [];
    rows = await fetchAuthenticatedLeadExpenseDocuments('new_lead_id', leadId);
  } else if (source.type === 'legacy') {
    const leadId = Number(source.leadId);
    if (!Number.isFinite(leadId) || leadId <= 0) return [];
    rows = await fetchAuthenticatedLeadExpenseDocuments('legacy_lead_id', leadId);
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
