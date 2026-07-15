import { supabase } from './supabase';

export const EMPLOYEE_HR_DOCUMENTS_BUCKET = 'employee-hr-documents' as const;

export type HrDocumentType = {
  id: number;
  slug: string;
  label: string;
  sort_order: number;
  is_active: boolean;
};

export type EmployeeHrDocument = {
  id: number;
  employee_id: number;
  document_type_id: number;
  storage_path: string;
  file_name: string;
  mime_type: string | null;
  notes: string | null;
  uploaded_by: string | null;
  created_at: string;
  updated_at: string;
  document_type?: HrDocumentType | null;
};

const TYPE_SELECT = 'id, slug, label, sort_order, is_active';
const DOC_SELECT = `
  id,
  employee_id,
  document_type_id,
  storage_path,
  file_name,
  mime_type,
  notes,
  uploaded_by,
  created_at,
  updated_at,
  document_type:hr_document_types (
    id, slug, label, sort_order, is_active
  )
`;

function guessMimeType(fileName: string, fallback?: string | null): string {
  if (fallback?.trim()) return fallback.trim();
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

function sanitizeFileName(name: string): string {
  return name.replace(/[^\w.\-()+ ]/g, '_').slice(0, 180) || 'file';
}

export function buildEmployeeHrDocumentStoragePath(
  employeeId: number,
  typeSlug: string,
  documentId: number,
  originalFileName: string,
): string {
  const safeType = typeSlug.replace(/[^\w\-]/g, '_').slice(0, 60) || 'doc';
  const safeName = sanitizeFileName(originalFileName);
  return `employees/${employeeId}/${safeType}/${documentId}_${Date.now()}_${safeName}`;
}

export async function fetchHrDocumentTypes(): Promise<HrDocumentType[]> {
  const { data, error } = await supabase
    .from('hr_document_types')
    .select(TYPE_SELECT)
    .eq('is_active', true)
    .order('sort_order', { ascending: true });

  if (error) throw error;
  return (data || []) as HrDocumentType[];
}

export async function fetchEmployeeHrDocuments(
  employeeId: number,
): Promise<EmployeeHrDocument[]> {
  const { data, error } = await supabase
    .from('employee_hr_documents')
    .select(DOC_SELECT)
    .eq('employee_id', employeeId)
    .order('created_at', { ascending: false });

  if (error) throw error;

  return (data || []).map((row: any) => ({
    ...row,
    document_type: Array.isArray(row.document_type)
      ? row.document_type[0] ?? null
      : row.document_type ?? null,
  })) as EmployeeHrDocument[];
}

export async function uploadEmployeeHrDocument(params: {
  employeeId: number;
  documentTypeId: number;
  typeSlug: string;
  file: File;
  notes?: string | null;
}): Promise<EmployeeHrDocument> {
  const { employeeId, documentTypeId, typeSlug, file, notes } = params;
  const mimeType = guessMimeType(file.name, file.type);
  const fileName = sanitizeFileName(file.name);

  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { data: inserted, error: insertError } = await supabase
    .from('employee_hr_documents')
    .insert({
      employee_id: employeeId,
      document_type_id: documentTypeId,
      storage_path: 'pending',
      file_name: fileName,
      mime_type: mimeType,
      notes: notes?.trim() || null,
      uploaded_by: user?.id ?? null,
    })
    .select('id')
    .single();

  if (insertError) throw insertError;
  const documentId = Number(inserted.id);
  const storagePath = buildEmployeeHrDocumentStoragePath(
    employeeId,
    typeSlug,
    documentId,
    fileName,
  );

  const { error: uploadError } = await supabase.storage
    .from(EMPLOYEE_HR_DOCUMENTS_BUCKET)
    .upload(storagePath, file, {
      contentType: mimeType,
      upsert: false,
    });

  if (uploadError) {
    await supabase.from('employee_hr_documents').delete().eq('id', documentId);
    throw uploadError;
  }

  const { data: updated, error: updateError } = await supabase
    .from('employee_hr_documents')
    .update({
      storage_path: storagePath,
      updated_at: new Date().toISOString(),
    })
    .eq('id', documentId)
    .select(DOC_SELECT)
    .single();

  if (updateError) throw updateError;

  return {
    ...(updated as any),
    document_type: Array.isArray((updated as any).document_type)
      ? (updated as any).document_type[0] ?? null
      : (updated as any).document_type ?? null,
  } as EmployeeHrDocument;
}

export async function deleteEmployeeHrDocument(
  document: Pick<EmployeeHrDocument, 'id' | 'storage_path'>,
): Promise<void> {
  const path = document.storage_path?.trim();
  if (path && path !== 'pending') {
    const { error: storageError } = await supabase.storage
      .from(EMPLOYEE_HR_DOCUMENTS_BUCKET)
      .remove([path]);
    if (storageError) {
      console.warn('employeeHrDocuments storage remove:', storageError);
    }
  }

  const { error } = await supabase
    .from('employee_hr_documents')
    .delete()
    .eq('id', document.id);

  if (error) throw error;
}
