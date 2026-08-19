import { supabase } from './supabase';

export const EMPLOYEE_PERSONAL_FILES_BUCKET = 'employee-personal-files' as const;

export type EmployeePersonalNote = {
  id: number;
  employee_id: number;
  title: string;
  body: string;
  created_at: string;
  updated_at: string;
};

export type EmployeePersonalFile = {
  id: number;
  employee_id: number;
  storage_path: string;
  file_name: string;
  mime_type: string | null;
  size_bytes: number | null;
  document_type: string | null;
  folder_id: string | null;
  created_at: string;
};

export type EmployeePersonalFolder = {
  id: string;
  employee_id: number;
  title: string;
  created_at: string;
  sort_order: number;
};

const NOTE_SELECT = 'id, employee_id, title, body, created_at, updated_at';
const FILE_SELECT =
  'id, employee_id, storage_path, file_name, mime_type, size_bytes, document_type, folder_id, created_at';
const FOLDER_SELECT = 'id, employee_id, title, created_at, sort_order';

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

export function buildEmployeePersonalFileStoragePath(
  employeeId: number,
  originalFileName: string,
): string {
  const safeName = sanitizeFileName(originalFileName);
  const id =
    typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  return `${employeeId}/${id}_${safeName}`;
}

export async function fetchEmployeePersonalNotes(
  employeeId: number,
): Promise<EmployeePersonalNote[]> {
  const { data, error } = await supabase
    .from('employee_personal_notes')
    .select(NOTE_SELECT)
    .eq('employee_id', employeeId)
    .order('updated_at', { ascending: false });

  if (error) throw error;
  return (data || []) as EmployeePersonalNote[];
}

export async function createEmployeePersonalNote(
  employeeId: number,
  fields?: { title?: string; body?: string },
): Promise<EmployeePersonalNote> {
  const { data, error } = await supabase
    .from('employee_personal_notes')
    .insert({
      employee_id: employeeId,
      title: fields?.title?.trim() || '',
      body: fields?.body ?? '',
    })
    .select(NOTE_SELECT)
    .single();

  if (error) throw error;
  return data as EmployeePersonalNote;
}

export async function updateEmployeePersonalNote(
  noteId: number,
  fields: { title?: string; body?: string },
): Promise<EmployeePersonalNote> {
  const patch: Record<string, string> = {};
  if (fields.title !== undefined) patch.title = fields.title;
  if (fields.body !== undefined) patch.body = fields.body;

  const { data, error } = await supabase
    .from('employee_personal_notes')
    .update(patch)
    .eq('id', noteId)
    .select(NOTE_SELECT)
    .single();

  if (error) throw error;
  return data as EmployeePersonalNote;
}

export async function deleteEmployeePersonalNote(noteId: number): Promise<void> {
  const { error } = await supabase
    .from('employee_personal_notes')
    .delete()
    .eq('id', noteId);

  if (error) throw error;
}

export async function fetchEmployeePersonalFiles(
  employeeId: number,
): Promise<EmployeePersonalFile[]> {
  const { data, error } = await supabase
    .from('employee_personal_files')
    .select(FILE_SELECT)
    .eq('employee_id', employeeId)
    .order('created_at', { ascending: false });

  if (error) throw error;
  return (data || []) as EmployeePersonalFile[];
}

export function normalizePersonalDocumentType(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed.slice(0, 80) : null;
}

export async function uploadEmployeePersonalFile(params: {
  employeeId: number;
  file: File;
  documentType?: string | null;
  folderId?: string | null;
}): Promise<EmployeePersonalFile> {
  const { employeeId, file } = params;
  const mimeType = guessMimeType(file.name, file.type);
  const fileName = sanitizeFileName(file.name);
  const storagePath = buildEmployeePersonalFileStoragePath(employeeId, fileName);
  const documentType = normalizePersonalDocumentType(params.documentType);

  const { error: uploadError } = await supabase.storage
    .from(EMPLOYEE_PERSONAL_FILES_BUCKET)
    .upload(storagePath, file, {
      contentType: mimeType,
      upsert: false,
    });

  if (uploadError) throw uploadError;

  const { data: inserted, error: insertError } = await supabase
    .from('employee_personal_files')
    .insert({
      employee_id: employeeId,
      storage_path: storagePath,
      file_name: fileName,
      mime_type: mimeType,
      size_bytes: file.size,
      document_type: documentType,
      folder_id: params.folderId || null,
    })
    .select(FILE_SELECT)
    .single();

  if (insertError) {
    await supabase.storage.from(EMPLOYEE_PERSONAL_FILES_BUCKET).remove([storagePath]);
    throw insertError;
  }

  return inserted as EmployeePersonalFile;
}

export async function deleteEmployeePersonalFile(
  file: Pick<EmployeePersonalFile, 'id' | 'storage_path'>,
): Promise<void> {
  const path = file.storage_path?.trim();
  if (path) {
    const { error: storageError } = await supabase.storage
      .from(EMPLOYEE_PERSONAL_FILES_BUCKET)
      .remove([path]);
    if (storageError) {
      console.warn('employeePersonalSpace storage remove:', storageError);
    }
  }

  const { error } = await supabase
    .from('employee_personal_files')
    .delete()
    .eq('id', file.id);

  if (error) throw error;
}

export async function renameEmployeePersonalFile(
  fileId: number,
  fileName: string,
): Promise<EmployeePersonalFile> {
  const nextName = sanitizeFileName(fileName.trim());
  if (!nextName) throw new Error('File name is required');

  const { data, error } = await supabase
    .from('employee_personal_files')
    .update({ file_name: nextName })
    .eq('id', fileId)
    .select(FILE_SELECT)
    .single();

  if (error) throw error;
  return data as EmployeePersonalFile;
}

export async function createEmployeePersonalFileSignedUrl(
  storagePath: string,
  expiresInSeconds = 3600,
): Promise<string> {
  const { data, error } = await supabase.storage
    .from(EMPLOYEE_PERSONAL_FILES_BUCKET)
    .createSignedUrl(storagePath.trim(), expiresInSeconds);

  if (error) throw error;
  if (!data?.signedUrl) throw new Error('Could not create a download link');
  return data.signedUrl;
}

export async function moveEmployeePersonalFile(
  fileId: number,
  folderId: string | null,
): Promise<EmployeePersonalFile> {
  const { data, error } = await supabase
    .from('employee_personal_files')
    .update({ folder_id: folderId })
    .eq('id', fileId)
    .select(FILE_SELECT)
    .single();

  if (error) throw error;
  return data as EmployeePersonalFile;
}

export async function fetchEmployeePersonalFolders(
  employeeId: number,
): Promise<EmployeePersonalFolder[]> {
  const { data, error } = await supabase
    .from('employee_personal_folders')
    .select(FOLDER_SELECT)
    .eq('employee_id', employeeId)
    .order('sort_order', { ascending: true })
    .order('created_at', { ascending: true });

  if (error) throw error;
  return (data || []) as EmployeePersonalFolder[];
}

export async function createEmployeePersonalFolder(
  employeeId: number,
  title: string,
): Promise<EmployeePersonalFolder> {
  const nextTitle = title.trim();
  if (!nextTitle) throw new Error('Folder title is required');

  const { data: existing } = await supabase
    .from('employee_personal_folders')
    .select('sort_order')
    .eq('employee_id', employeeId)
    .order('sort_order', { ascending: false })
    .limit(1);

  const maxSort = Number(existing?.[0]?.sort_order) || 0;

  const { data, error } = await supabase
    .from('employee_personal_folders')
    .insert({
      employee_id: employeeId,
      title: nextTitle.slice(0, 80),
      sort_order: maxSort + 1,
    })
    .select(FOLDER_SELECT)
    .single();

  if (error) throw error;
  return data as EmployeePersonalFolder;
}

export async function renameEmployeePersonalFolder(
  folderId: string,
  title: string,
): Promise<EmployeePersonalFolder> {
  const nextTitle = title.trim();
  if (!nextTitle) throw new Error('Folder title is required');

  const { data, error } = await supabase
    .from('employee_personal_folders')
    .update({ title: nextTitle.slice(0, 80) })
    .eq('id', folderId)
    .select(FOLDER_SELECT)
    .single();

  if (error) throw error;
  return data as EmployeePersonalFolder;
}

export async function deleteEmployeePersonalFolder(folderId: string): Promise<void> {
  const { error } = await supabase
    .from('employee_personal_folders')
    .delete()
    .eq('id', folderId);

  if (error) throw error;
}
