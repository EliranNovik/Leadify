import { supabase } from './supabase';

export const OFFICE_DOCUMENTS_BUCKET = 'office-documents' as const;

export type OfficeDocument = {
  id: number;
  storage_path: string;
  file_name: string;
  mime_type: string | null;
  size_bytes: number | null;
  document_type: string | null;
  folder_id: string | null;
  department_id: number | null;
  created_at: string;
};

export type OfficeDocumentFolder = {
  id: string;
  title: string;
  created_at: string;
  sort_order: number;
  department_id: number | null;
};

const FILE_SELECT =
  'id, storage_path, file_name, mime_type, size_bytes, document_type, folder_id, department_id, created_at';
const FOLDER_SELECT = 'id, title, created_at, sort_order, department_id';

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
    txt: 'text/plain',
    csv: 'text/csv',
  };
  return map[ext] || 'application/octet-stream';
}

function sanitizeFileName(name: string): string {
  return name.replace(/[^\w.\-()+ ]/g, '_').slice(0, 180) || 'file';
}

/**
 * The storage policies read the department out of the path, so one department space cannot
 * reach another's objects. The admin space keeps the original `office/` prefix, so it stays the
 * same place the organization Office tab has always written to.
 */
export function officeStorageSpacePrefix(departmentId: number | null | undefined): string {
  return departmentId == null ? 'office' : `office/dept-${departmentId}`;
}

export function buildOfficeDocumentStoragePath(
  originalFileName: string,
  departmentId: number | null = null,
): string {
  const safeName = sanitizeFileName(originalFileName);
  const id =
    typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  return `${officeStorageSpacePrefix(departmentId)}/${id}_${safeName}`;
}

export function normalizeOfficeDocumentType(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed.slice(0, 80) : null;
}

/** Pass a department id for that department's space, `null` for the admin space, or nothing for all. */
export async function fetchOfficeDocuments(
  departmentId?: number | null,
): Promise<OfficeDocument[]> {
  let request = supabase.from('office_documents').select(FILE_SELECT);
  if (departmentId !== undefined) {
    request = departmentId == null
      ? request.is('department_id', null)
      : request.eq('department_id', departmentId);
  }

  const { data, error } = await request.order('created_at', { ascending: false });

  if (error) throw error;
  return (data || []) as OfficeDocument[];
}

export async function uploadOfficeDocument(params: {
  file: File;
  documentType?: string | null;
  folderId?: string | null;
  departmentId?: number | null;
}): Promise<OfficeDocument> {
  const mimeType = guessMimeType(params.file.name, params.file.type);
  const fileName = sanitizeFileName(params.file.name);
  const departmentId = params.departmentId ?? null;
  const storagePath = buildOfficeDocumentStoragePath(fileName, departmentId);
  const documentType = normalizeOfficeDocumentType(params.documentType);

  const { error: uploadError } = await supabase.storage
    .from(OFFICE_DOCUMENTS_BUCKET)
    .upload(storagePath, params.file, {
      contentType: mimeType,
      upsert: false,
    });

  if (uploadError) throw uploadError;

  const { data: inserted, error: insertError } = await supabase
    .from('office_documents')
    .insert({
      storage_path: storagePath,
      file_name: fileName,
      mime_type: mimeType,
      size_bytes: params.file.size,
      document_type: documentType,
      folder_id: params.folderId || null,
      department_id: departmentId,
    })
    .select(FILE_SELECT)
    .single();

  if (insertError) {
    await supabase.storage.from(OFFICE_DOCUMENTS_BUCKET).remove([storagePath]);
    throw insertError;
  }

  return inserted as OfficeDocument;
}

export async function deleteOfficeDocument(
  file: Pick<OfficeDocument, 'id' | 'storage_path'>,
): Promise<void> {
  const path = file.storage_path?.trim();
  if (path) {
    const { error: storageError } = await supabase.storage
      .from(OFFICE_DOCUMENTS_BUCKET)
      .remove([path]);
    if (storageError) {
      console.warn('officeDocuments storage remove:', storageError);
    }
  }

  const { error } = await supabase.from('office_documents').delete().eq('id', file.id);
  if (error) throw error;
}

export async function renameOfficeDocument(
  fileId: number,
  fileName: string,
): Promise<OfficeDocument> {
  const nextName = sanitizeFileName(fileName.trim());
  if (!nextName) throw new Error('File name is required');

  const { data, error } = await supabase
    .from('office_documents')
    .update({ file_name: nextName })
    .eq('id', fileId)
    .select(FILE_SELECT)
    .single();

  if (error) throw error;
  return data as OfficeDocument;
}

export async function createOfficeDocumentSignedUrl(
  storagePath: string,
  expiresInSeconds = 3600,
): Promise<string> {
  const { data, error } = await supabase.storage
    .from(OFFICE_DOCUMENTS_BUCKET)
    .createSignedUrl(storagePath.trim(), expiresInSeconds);

  if (error) throw error;
  if (!data?.signedUrl) throw new Error('Could not create a download link');
  return data.signedUrl;
}

export async function moveOfficeDocument(
  fileId: number,
  folderId: string | null,
): Promise<OfficeDocument> {
  const { data, error } = await supabase
    .from('office_documents')
    .update({ folder_id: folderId })
    .eq('id', fileId)
    .select(FILE_SELECT)
    .single();

  if (error) throw error;
  return data as OfficeDocument;
}

/** Pass a department id for that department's space, or `null` for the admin space. */
export async function fetchOfficeDocumentFolders(
  departmentId?: number | null,
): Promise<OfficeDocumentFolder[]> {
  let request = supabase.from('office_document_folders').select(FOLDER_SELECT);
  if (departmentId !== undefined) {
    request = departmentId == null
      ? request.is('department_id', null)
      : request.eq('department_id', departmentId);
  }

  const { data, error } = await request
    .order('sort_order', { ascending: true })
    .order('created_at', { ascending: true });

  if (error) throw error;
  return (data || []) as OfficeDocumentFolder[];
}

export async function createOfficeDocumentFolder(
  title: string,
  departmentId: number | null = null,
): Promise<OfficeDocumentFolder> {
  const nextTitle = title.trim();
  if (!nextTitle) throw new Error('Folder title is required');

  const { data: existing } = await supabase
    .from('office_document_folders')
    .select('sort_order')
    .order('sort_order', { ascending: false })
    .limit(1);

  const maxSort = Number(existing?.[0]?.sort_order) || 0;

  const { data, error } = await supabase
    .from('office_document_folders')
    .insert({
      title: nextTitle.slice(0, 80),
      sort_order: maxSort + 1,
      department_id: departmentId,
    })
    .select(FOLDER_SELECT)
    .single();

  if (error) throw error;
  return data as OfficeDocumentFolder;
}

export async function renameOfficeDocumentFolder(
  folderId: string,
  title: string,
): Promise<OfficeDocumentFolder> {
  const nextTitle = title.trim();
  if (!nextTitle) throw new Error('Folder title is required');

  const { data, error } = await supabase
    .from('office_document_folders')
    .update({ title: nextTitle.slice(0, 80) })
    .eq('id', folderId)
    .select(FOLDER_SELECT)
    .single();

  if (error) throw error;
  return data as OfficeDocumentFolder;
}

export async function deleteOfficeDocumentFolder(folderId: string): Promise<void> {
  const { error } = await supabase.from('office_document_folders').delete().eq('id', folderId);
  if (error) throw error;
}
