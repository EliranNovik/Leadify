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
  created_at: string;
};

export type OfficeDocumentFolder = {
  id: string;
  title: string;
  created_at: string;
  sort_order: number;
};

const FILE_SELECT =
  'id, storage_path, file_name, mime_type, size_bytes, document_type, folder_id, created_at';
const FOLDER_SELECT = 'id, title, created_at, sort_order';

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

export function buildOfficeDocumentStoragePath(originalFileName: string): string {
  const safeName = sanitizeFileName(originalFileName);
  const id =
    typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  return `office/${id}_${safeName}`;
}

export function normalizeOfficeDocumentType(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed.slice(0, 80) : null;
}

export async function fetchOfficeDocuments(): Promise<OfficeDocument[]> {
  const { data, error } = await supabase
    .from('office_documents')
    .select(FILE_SELECT)
    .order('created_at', { ascending: false });

  if (error) throw error;
  return (data || []) as OfficeDocument[];
}

export async function uploadOfficeDocument(params: {
  file: File;
  documentType?: string | null;
  folderId?: string | null;
}): Promise<OfficeDocument> {
  const mimeType = guessMimeType(params.file.name, params.file.type);
  const fileName = sanitizeFileName(params.file.name);
  const storagePath = buildOfficeDocumentStoragePath(fileName);
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

export async function fetchOfficeDocumentFolders(): Promise<OfficeDocumentFolder[]> {
  const { data, error } = await supabase
    .from('office_document_folders')
    .select(FOLDER_SELECT)
    .order('sort_order', { ascending: true })
    .order('created_at', { ascending: true });

  if (error) throw error;
  return (data || []) as OfficeDocumentFolder[];
}

export async function createOfficeDocumentFolder(title: string): Promise<OfficeDocumentFolder> {
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
