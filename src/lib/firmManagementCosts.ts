import { convertToNIS } from './currencyConversion';
import { supabase } from './supabase';
import { FIRM_INVOICE_DOCUMENTS_BUCKET, buildFirmInvoiceStoragePath } from './firmInvoiceDocuments';
import { toast } from 'react-hot-toast';

export const FIRM_MANAGEMENT_DEFAULT_CURRENCY = 'ILS';

export type FirmInvoiceDoc = {
  id: string;
  firm_id: string;
  invoice_month: string;
  firm_management_cost_id?: string | null;
  file_name: string | null;
  storage_path: string | null;
  mime_type: string | null;
};

export const managementCostInvoiceKey = (firmId: string, month: unknown): string => {
  const anchor = toBillingMonthStart(month) || String(month ?? '').trim().slice(0, 10);
  return `${firmId}|${anchor}`;
};

/** Prefer cost line id; fall back to legacy firm+month key. */
export const managementCostLineKey = (
  costId: string | null | undefined,
  firmId?: string,
  month?: unknown,
): string => {
  if (costId?.trim()) return `cost:${costId.trim()}`;
  if (firmId) return `legacy:${managementCostInvoiceKey(firmId, month)}`;
  return 'legacy:unknown';
};

export const toBillingMonthStart = (value: unknown): string | null => {
  if (value == null || value === '') return null;
  const s = String(value).trim().slice(0, 10);
  const match = s.match(/^(\d{4})-(\d{2})/);
  if (!match) return null;
  return `${match[1]}-${match[2]}-01`;
};

export const formatBillingMonthLabel = (value: unknown): string => {
  const monthStart = toBillingMonthStart(value);
  if (!monthStart) return '—';
  const d = new Date(`${monthStart}T12:00:00`);
  if (Number.isNaN(d.getTime())) return String(value);
  return d.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
};

export const formatFirmManagementAmount = (amount: unknown, currency?: string | null): string => {
  const n = managementAmountToNis(amount, currency);
  if (!Number.isFinite(n)) return '—';
  return new Intl.NumberFormat('he-IL', {
    style: 'currency',
    currency: 'ILS',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(n);
};

/** Same NIS normalization as MarketingDashboardReport / ExternalFirmsReportPage. */
export function managementAmountToNis(amount: unknown, currency: string | null | undefined): number {
  const raw = Number(amount);
  if (!Number.isFinite(raw) || raw === 0) return 0;
  const sym = (currency || FIRM_MANAGEMENT_DEFAULT_CURRENCY).trim();
  try {
    return convertToNIS(raw, sym === 'ILS' ? '₪' : sym);
  } catch {
    return raw;
  }
}

export const applyBillingMonthFilter = (query: any, month: string, year: string) =>
  applyMonthAnchorFilter(query, 'billing_month', month, year);

export const applyMonthAnchorFilter = (
  query: any,
  column: string,
  month: string,
  year: string,
) => {
  if (year && month) {
    return query.eq(column, `${year}-${month}-01`);
  }
  if (year) {
    return query.gte(column, `${year}-01-01`).lt(column, `${Number(year) + 1}-01-01`);
  }
  return query;
};

/** firm_id + invoice_month → invoice rows (for management cost table column). */
export async function fetchFirmInvoicesIndex(
  month: string,
  year: string,
): Promise<Map<string, FirmInvoiceDoc[]>> {
  let q = supabase
    .from('firm_invoices')
    .select('id, firm_id, invoice_month, firm_management_cost_id, file_name, storage_path, mime_type');
  q = applyMonthAnchorFilter(q, 'invoice_month', month, year);
  const { data, error } = await q;
  if (error) {
    throw error;
  }

  const index = new Map<string, FirmInvoiceDoc[]>();
  (data || []).forEach((row: FirmInvoiceDoc) => {
    const key = managementCostLineKey(row.firm_management_cost_id, row.firm_id, row.invoice_month);
    const list = index.get(key) || [];
    list.push(row);
    index.set(key, list);
  });
  return index;
}

export async function fetchInvoicesForCostLine(
  costId: string,
  firmId?: string,
  billingMonth?: unknown,
): Promise<FirmInvoiceDoc[]> {
  if (!costId?.trim()) return fetchInvoicesForFirmMonth(firmId || '', billingMonth);

  const { data, error } = await supabase
    .from('firm_invoices')
    .select('id, firm_id, invoice_month, firm_management_cost_id, file_name, storage_path, mime_type')
    .eq('firm_management_cost_id', costId)
    .order('created_at', { ascending: false });

  if (error) throw error;
  return (data || []) as FirmInvoiceDoc[];
}

export async function fetchInvoicesForFirmMonth(
  firmId: string,
  billingMonth: unknown,
): Promise<FirmInvoiceDoc[]> {
  const anchor = toBillingMonthStart(billingMonth);
  if (!firmId || !anchor) return [];

  const { data, error } = await supabase
    .from('firm_invoices')
    .select('id, firm_id, invoice_month, firm_management_cost_id, file_name, storage_path, mime_type')
    .eq('firm_id', firmId)
    .eq('invoice_month', anchor)
    .order('created_at', { ascending: false });

  if (error) throw error;
  return (data || []) as FirmInvoiceDoc[];
}

export async function uploadInvoiceForFirmMonth(
  firmId: string,
  billingMonth: unknown,
  file: File,
  firmManagementCostId?: string | null,
): Promise<FirmInvoiceDoc> {
  const invoice_month = toBillingMonthStart(billingMonth);
  if (!firmId || !invoice_month) {
    throw new Error('Select firm and month before uploading an invoice');
  }

  const { data: inserted, error: insErr } = await supabase
    .from('firm_invoices')
    .insert([
      {
        firm_id: firmId,
        invoice_month,
        firm_management_cost_id: firmManagementCostId?.trim() || null,
        amount: null,
        currency: FIRM_MANAGEMENT_DEFAULT_CURRENCY,
        notes: null,
      },
    ])
    .select('id, firm_id, invoice_month, firm_management_cost_id, file_name, storage_path, mime_type')
    .single();
  if (insErr) throw insErr;

  const rowId = inserted.id;
  const path = buildFirmInvoiceStoragePath(firmId, rowId, file.name);
  const { error: upErr } = await supabase.storage
    .from(FIRM_INVOICE_DOCUMENTS_BUCKET)
    .upload(path, file, { contentType: file.type || undefined, upsert: true });
  if (upErr) throw upErr;

  const { data: updated, error: uErr } = await supabase
    .from('firm_invoices')
    .update({
      storage_path: path,
      file_name: file.name,
      mime_type: file.type || null,
      invoice_month,
      firm_management_cost_id: firmManagementCostId?.trim() || null,
    })
    .eq('id', rowId)
    .select('id, firm_id, invoice_month, firm_management_cost_id, file_name, storage_path, mime_type')
    .single();

  if (uErr) throw uErr;
  return updated as FirmInvoiceDoc;
}

export async function removeFirmInvoice(invoice: FirmInvoiceDoc): Promise<void> {
  if (invoice.storage_path?.trim()) {
    await supabase.storage.from(FIRM_INVOICE_DOCUMENTS_BUCKET).remove([invoice.storage_path.trim()]);
  }
  const { error } = await supabase.from('firm_invoices').delete().eq('id', invoice.id);
  if (error) throw error;
}

export async function openFirmInvoiceDocument(row: Pick<FirmInvoiceDoc, 'storage_path'>): Promise<void> {
  if (!row.storage_path?.trim()) {
    toast.error('No document uploaded for this invoice');
    return;
  }
  const { data, error } = await supabase.storage
    .from(FIRM_INVOICE_DOCUMENTS_BUCKET)
    .createSignedUrl(row.storage_path.trim(), 3600);
  if (error || !data?.signedUrl) {
    toast.error('Could not open file');
    return;
  }
  window.open(data.signedUrl, '_blank', 'noopener,noreferrer');
}
