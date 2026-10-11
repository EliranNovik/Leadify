import { supabase } from './supabase';
import { toast } from 'react-hot-toast';
import {
  paymentPlanTaxInvoiceState,
  type PaymentPlanTaxInvoiceState,
  type TaxInvoiceTarget,
} from './markPaymentPlanTaxInvoiceSent';

/**
 * Files attached to a manual "tax invoice sent" mark.
 *
 * Created by sql/2026-10-11_payment_plan_tax_invoice_documents.sql. A tax invoice paid through a
 * payment link is issued by Payper and needs no copy here; these are the invoices issued outside
 * that flow, where the file a handler uploads is the only record of it.
 */
export const PAYMENT_PLAN_TAX_INVOICE_DOCUMENTS_BUCKET = 'payment-plan-tax-invoice-documents';
export const TAX_INVOICE_DOC_MAX_BYTES = 15 * 1024 * 1024;
export const TAX_INVOICE_DOC_MAX_FILES = 10;
const SIGNED_URL_SECONDS = 3600;

export type PaymentPlanTaxInvoiceDocumentRow = {
  id: number;
  payment_plan_id: number;
  is_legacy: boolean;
  file_name: string;
  mime_type: string | null;
  file_size: number | null;
  storage_path: string;
  created_at: string;
  uploaded_by_employee_id: number | null;
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

function guessMimeTypeFromFileName(fileName: string): string {
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

/** The reason the file is unacceptable, or null when it is fine. */
export function validateTaxInvoiceDocumentFile(file: File): string | null {
  if (file.size > TAX_INVOICE_DOC_MAX_BYTES) {
    return `${file.name} is larger than 15 MB`;
  }
  const mime = file.type || guessMimeTypeFromFileName(file.name);
  if (file.type && !ALLOWED_MIME.has(file.type) && !ALLOWED_MIME.has(mime)) {
    return `${file.name} is not a supported file type (PDF, image, Word, Excel)`;
  }
  return null;
}

/**
 * Which payment row a document belongs to. The id alone is ambiguous because new and legacy leads
 * keep their payments in different tables whose ids overlap, so `isLegacy` travels with it.
 */
export type TaxInvoiceDocumentTarget = {
  paymentPlanId: number;
  isLegacy: boolean;
};

/** The target in the shape `markPaymentPlanTaxInvoiceSent` expects. */
export function taxInvoiceWriteTarget(target: TaxInvoiceDocumentTarget): TaxInvoiceTarget {
  return { kind: target.isLegacy ? 'legacy' : 'new', paymentPlanId: target.paymentPlanId };
}

function storagePath(target: TaxInvoiceDocumentTarget, fileName: string): string {
  const scope = target.isLegacy ? 'legacy' : 'new';
  return `tax-invoices/${scope}/${target.paymentPlanId}/${Date.now()}_${sanitizeFileName(fileName)}`;
}

/**
 * The signed-in user's employee id, for naming the uploader later.
 *
 * Forgiving by design: a missing employee id must not stop the upload, so every failure path
 * yields null rather than throwing.
 */
async function resolveActorEmployeeId(): Promise<number | null> {
  try {
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user?.id) return null;

    let { data: row } = await supabase
      .from('users')
      .select('employee_id')
      .eq('auth_id', user.id)
      .maybeSingle();
    if ((row?.employee_id == null || row.employee_id === '') && user.email) {
      const { data: byEmail } = await supabase
        .from('users')
        .select('employee_id')
        .eq('email', user.email)
        .maybeSingle();
      if (byEmail) row = byEmail;
    }

    const raw = row?.employee_id;
    const parsed = raw == null || raw === '' ? NaN : Number(raw);
    return Number.isFinite(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

const DOCUMENT_COLUMNS =
  'id, payment_plan_id, is_legacy, file_name, mime_type, file_size, storage_path, created_at, uploaded_by_employee_id';

function toDocumentRow(row: any): PaymentPlanTaxInvoiceDocumentRow {
  return {
    id: Number(row.id),
    payment_plan_id: Number(row.payment_plan_id),
    is_legacy: Boolean(row.is_legacy),
    file_name: String(row.file_name || 'file'),
    mime_type: row.mime_type != null ? String(row.mime_type) : null,
    file_size: row.file_size != null ? Number(row.file_size) : null,
    storage_path: String(row.storage_path),
    created_at: String(row.created_at),
    uploaded_by_employee_id:
      row.uploaded_by_employee_id != null ? Number(row.uploaded_by_employee_id) : null,
  };
}

export async function fetchPaymentPlanTaxInvoiceDocuments(
  target: TaxInvoiceDocumentTarget,
): Promise<PaymentPlanTaxInvoiceDocumentRow[]> {
  if (!target.paymentPlanId) return [];
  const { data, error } = await supabase
    .from('payment_plan_tax_invoice_documents')
    .select(DOCUMENT_COLUMNS)
    .eq('payment_plan_id', target.paymentPlanId)
    .eq('is_legacy', target.isLegacy)
    .order('created_at', { ascending: true });
  if (error) {
    console.warn('[paymentPlanTaxInvoiceDocuments] list:', error.message || error);
    return [];
  }
  return (data || []).map(toDocumentRow);
}

/**
 * Uploads each file and records it. Returns how many landed, so a partial failure can be reported
 * without losing the files that did make it.
 *
 * A file whose metadata row fails to insert is removed from storage again: leaving it behind would
 * orphan an object nothing can ever list or delete.
 */
export async function uploadPaymentPlanTaxInvoiceDocuments(
  target: TaxInvoiceDocumentTarget,
  files: File[],
): Promise<number> {
  if (!target.paymentPlanId || !files.length) return 0;
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const employeeId = await resolveActorEmployeeId();
  let uploaded = 0;

  for (const file of files) {
    const errMsg = validateTaxInvoiceDocumentFile(file);
    if (errMsg) {
      toast.error(errMsg);
      continue;
    }
    const path = storagePath(target, file.name);
    const mime = file.type || guessMimeTypeFromFileName(file.name);
    const { error: upErr } = await supabase.storage
      .from(PAYMENT_PLAN_TAX_INVOICE_DOCUMENTS_BUCKET)
      .upload(path, file, { contentType: mime, upsert: false });
    if (upErr) {
      toast.error(`Could not upload ${file.name}`);
      console.warn('[paymentPlanTaxInvoiceDocuments] upload:', upErr);
      continue;
    }
    const { error: insErr } = await supabase.from('payment_plan_tax_invoice_documents').insert({
      payment_plan_id: target.paymentPlanId,
      is_legacy: target.isLegacy,
      file_name: file.name,
      mime_type: mime,
      file_size: file.size,
      storage_path: path,
      uploaded_by: user?.id || null,
      uploaded_by_employee_id: employeeId,
    });
    if (insErr) {
      await supabase.storage.from(PAYMENT_PLAN_TAX_INVOICE_DOCUMENTS_BUCKET).remove([path]);
      toast.error(`Could not save ${file.name}`);
      console.warn('[paymentPlanTaxInvoiceDocuments] insert:', insErr);
      continue;
    }
    uploaded += 1;
  }

  return uploaded;
}

/**
 * Removes the row first, then the file. The other order would leave a row pointing at nothing if
 * the delete half-failed, which reads as a broken document rather than an absent one.
 */
export async function deletePaymentPlanTaxInvoiceDocument(
  doc: PaymentPlanTaxInvoiceDocumentRow,
): Promise<boolean> {
  const { error } = await supabase
    .from('payment_plan_tax_invoice_documents')
    .delete()
    .eq('id', doc.id);
  if (error) {
    console.warn('[paymentPlanTaxInvoiceDocuments] delete:', error.message || error);
    toast.error(`Could not remove ${doc.file_name}`);
    return false;
  }
  await supabase.storage
    .from(PAYMENT_PLAN_TAX_INVOICE_DOCUMENTS_BUCKET)
    .remove([doc.storage_path]);
  return true;
}

export async function getTaxInvoiceDocumentSignedUrl(path: string): Promise<string | null> {
  if (!path.trim()) return null;
  const { data, error } = await supabase.storage
    .from(PAYMENT_PLAN_TAX_INVOICE_DOCUMENTS_BUCKET)
    .createSignedUrl(path.trim(), SIGNED_URL_SECONDS);
  if (error || !data?.signedUrl) {
    console.warn('[paymentPlanTaxInvoiceDocuments] signed url:', error);
    return null;
  }
  return data.signedUrl;
}

export async function signPaymentPlanTaxInvoiceDocuments(
  docs: PaymentPlanTaxInvoiceDocumentRow[],
): Promise<Array<PaymentPlanTaxInvoiceDocumentRow & { signedUrl: string }>> {
  const signed = await Promise.all(
    docs.map(async (doc) => {
      const signedUrl = await getTaxInvoiceDocumentSignedUrl(doc.storage_path);
      return signedUrl ? { ...doc, signedUrl } : null;
    }),
  );
  return signed.filter(
    (row): row is PaymentPlanTaxInvoiceDocumentRow & { signedUrl: string } => Boolean(row),
  );
}

/**
 * Reads the mark straight from the payment row, so the drawer always opens on the saved state
 * rather than on whatever the host screen last happened to hold.
 */
export async function fetchPaymentPlanTaxInvoiceState(
  target: TaxInvoiceDocumentTarget,
): Promise<PaymentPlanTaxInvoiceState> {
  const table = target.isLegacy ? 'finances_paymentplanrow' : 'payment_plans';
  const { data, error } = await supabase
    .from(table)
    .select('tax_invoice_sent, tax_invoice_sent_at, tax_invoice_sent_by')
    .eq('id', target.paymentPlanId)
    .maybeSingle();
  if (error) {
    console.warn('[paymentPlanTaxInvoiceDocuments] state:', error.message || error);
  }
  return paymentPlanTaxInvoiceState(data ?? null);
}

export type EmployeeProfile = {
  name: string;
  photoUrl: string | null;
};

/** Names and photos for employee ids, for showing whoever recorded or uploaded something. */
export async function fetchEmployeeProfiles(ids: number[]): Promise<Map<number, EmployeeProfile>> {
  const unique = Array.from(new Set(ids.filter((id) => Number.isFinite(id) && id > 0)));
  const profiles = new Map<number, EmployeeProfile>();
  if (!unique.length) return profiles;
  const { data, error } = await supabase
    .from('tenants_employee')
    .select('id, display_name, photo_url, photo')
    .in('id', unique);
  if (error) {
    console.warn('[paymentPlanTaxInvoiceDocuments] employee profiles:', error.message || error);
    return profiles;
  }
  (data || []).forEach((row: any) => {
    if (row?.id == null) return;
    profiles.set(Number(row.id), {
      name: String(row.display_name ?? ''),
      // Two photo columns exist and either may be the populated one.
      photoUrl: row.photo_url || row.photo || null,
    });
  });
  return profiles;
}
