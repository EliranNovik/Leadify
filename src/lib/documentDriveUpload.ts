import { supabase } from './supabase';
import {
  buildCaseDocumentStoragePath,
  buildStaffMeetingDocumentStoragePath,
  CASE_DOCUMENTS_STORAGE_BUCKET,
  resolveCaseDocumentUploadContentType,
} from './caseDocumentsStorage';
import { ensureFolderPath, type DocumentFolderScope } from './documentFolders';
import { OFFICE_DOCUMENTS_BUCKET, uploadOfficeDocument } from './officeDocuments';
import {
  EMPLOYEE_PERSONAL_FILES_BUCKET,
  uploadEmployeePersonalFile,
} from './employeePersonalSpace';
import type { FolderUploadEntry } from './browserFolderUpload';

/**
 * Uploading from the central documents page, where the destination is chosen rather than implied
 * by the page you are on. Case documents keep the same storage layout and folder tree as the
 * drawer; the other stores reuse their own upload helpers.
 */

export type DriveDestination =
  | {
      kind: 'lead';
      leadNumber: string;
      leadName?: string | null;
      classificationId: string;
      classificationLabel?: string | null;
      folderId: string | null;
    }
  | { kind: 'staff_meeting'; meetingId: number; meetingTitle?: string | null }
  | { kind: 'office'; folderId: string | null; departmentId: number | null; spaceLabel?: string }
  | { kind: 'personal'; employeeId: number };

/** Only case documents sit in the nestable tree, so only they accept a folder upload. */
export function destinationSupportsFolders(destination: DriveDestination): boolean {
  return destination.kind === 'lead';
}

export function describeDestination(destination: DriveDestination): string {
  switch (destination.kind) {
    case 'lead':
      return [destination.leadNumber, destination.classificationLabel].filter(Boolean).join(' · ');
    case 'staff_meeting':
      return destination.meetingTitle?.trim() || `Meeting ${destination.meetingId}`;
    case 'office':
      return `Office · ${destination.spaceLabel?.trim() || 'Admins'}`;
    case 'personal':
      return 'My space';
  }
}

export type DriveClassification = { id: string; slug: string; label: string };

export async function fetchDriveClassifications(): Promise<DriveClassification[]> {
  const { data, error } = await supabase
    .from('case_document_classifications')
    .select('id, slug, label, sort_order')
    .eq('is_active', true)
    .order('sort_order', { ascending: true });

  if (error) throw error;
  return (data || []) as DriveClassification[];
}

export type DriveMeetingOption = { id: number; label: string; when: string | null };

/** Internal staff meetings, newest first, narrowed by subject when a term is given. */
export async function searchDriveMeetings(term: string): Promise<DriveMeetingOption[]> {
  let query = supabase
    .from('meetings')
    .select('id, meeting_subject, meeting_date, meeting_time')
    .order('meeting_date', { ascending: false })
    .limit(25);

  const trimmed = term.replace(/[,()*\\]/g, ' ').trim();
  if (trimmed) query = query.ilike('meeting_subject', `%${trimmed}%`);

  const { data, error } = await query;
  if (error) throw error;

  return (data || []).map((row: any) => ({
    id: Number(row.id),
    label: String(row.meeting_subject || '').trim() || `Meeting ${row.id}`,
    when: row.meeting_date
      ? [row.meeting_date, row.meeting_time].filter(Boolean).join(' ')
      : null,
  }));
}

function isDuplicateStorageObject(error: unknown): boolean {
  const err = error as { statusCode?: string | number; message?: string } | null;
  const status = String(err?.statusCode ?? '');
  const message = String(err?.message ?? '').toLowerCase();
  return status === '409' || message.includes('already exists');
}

/** Same bucket and prefix as the drawer, with a random suffix only to dodge a name clash. */
function withUniqueBasename(path: string): string {
  const slash = path.lastIndexOf('/');
  const dir = slash >= 0 ? path.slice(0, slash + 1) : '';
  const base = slash >= 0 ? path.slice(slash + 1) : path;
  return `${dir}${Math.random().toString(36).slice(2, 8)}-${base}`;
}

async function uploadCaseDocument(params: {
  destination: Extract<DriveDestination, { kind: 'lead' }>;
  entry: FolderUploadEntry;
  folderId: string | null;
  uploadedBy: string | null;
}): Promise<DriveCreatedFile> {
  const { file } = params.entry;
  const contentType = resolveCaseDocumentUploadContentType(file);
  let storagePath = buildCaseDocumentStoragePath(params.destination.leadNumber, null, file.name);

  let { error: uploadError } = await supabase.storage
    .from(CASE_DOCUMENTS_STORAGE_BUCKET)
    .upload(storagePath, file, { contentType, upsert: false });

  if (uploadError && isDuplicateStorageObject(uploadError)) {
    storagePath = withUniqueBasename(storagePath);
    ({ error: uploadError } = await supabase.storage
      .from(CASE_DOCUMENTS_STORAGE_BUCKET)
      .upload(storagePath, file, { contentType, upsert: false }));
  }
  if (uploadError) throw uploadError;

  const { error: insertError } = await supabase.from('lead_case_documents').insert({
    lead_number: params.destination.leadNumber,
    onedrive_subfolder: null,
    onedrive_item_id: null,
    storage_path: storagePath,
    file_name: file.name,
    file_size: file.size,
    mime_type: contentType,
    classification_id: params.destination.classificationId,
    folder_id: params.folderId,
    uploaded_by: params.uploadedBy,
    ai_summary_status: 'pending',
  });

  if (insertError) {
    await supabase.storage.from(CASE_DOCUMENTS_STORAGE_BUCKET).remove([storagePath]);
    throw insertError;
  }

  return {
    bucket: CASE_DOCUMENTS_STORAGE_BUCKET,
    storagePath,
    fileName: file.name,
    mimeType: contentType,
  };
}

async function uploadStaffMeetingDocument(params: {
  meetingId: number;
  file: File;
  uploadedBy: string | null;
}): Promise<DriveCreatedFile> {
  const { file } = params;
  const contentType = resolveCaseDocumentUploadContentType(file);
  let storagePath = buildStaffMeetingDocumentStoragePath(params.meetingId, file.name);

  let { error: uploadError } = await supabase.storage
    .from(CASE_DOCUMENTS_STORAGE_BUCKET)
    .upload(storagePath, file, { contentType, upsert: false });

  if (uploadError && isDuplicateStorageObject(uploadError)) {
    storagePath = withUniqueBasename(storagePath);
    ({ error: uploadError } = await supabase.storage
      .from(CASE_DOCUMENTS_STORAGE_BUCKET)
      .upload(storagePath, file, { contentType, upsert: false }));
  }
  if (uploadError) throw uploadError;

  const { error: insertError } = await supabase.from('staff_meeting_documents').insert({
    meeting_id: params.meetingId,
    storage_path: storagePath,
    file_name: file.name,
    file_size: file.size,
    mime_type: contentType,
    uploaded_by: params.uploadedBy,
    ai_summary_status: 'skipped',
  });

  if (insertError) {
    await supabase.storage.from(CASE_DOCUMENTS_STORAGE_BUCKET).remove([storagePath]);
    throw insertError;
  }

  return {
    bucket: CASE_DOCUMENTS_STORAGE_BUCKET,
    storagePath,
    fileName: file.name,
    mimeType: contentType,
  };
}

/** Where a file ended up, which is what opening it straight afterwards needs. */
export type DriveCreatedFile = {
  bucket: string;
  storagePath: string;
  fileName: string;
  mimeType: string;
};

export type DriveUploadResult = {
  succeeded: number;
  failed: number;
  lastError: string | null;
  foldersCreated: number;
  /** In the order they were uploaded, for the ones that worked. */
  created: DriveCreatedFile[];
};

export async function uploadEntriesToDestination(params: {
  destination: DriveDestination;
  entries: FolderUploadEntry[];
  folderPaths?: string[];
  uploadedBy?: string | null;
  onProgress?: (done: number, total: number) => void;
}): Promise<DriveUploadResult> {
  const { destination, entries } = params;
  const uploadedBy = params.uploadedBy?.trim() || null;
  const result: DriveUploadResult = {
    succeeded: 0,
    failed: 0,
    lastError: null,
    foldersCreated: 0,
    created: [],
  };
  if (entries.length === 0) return result;

  // Folders first, so every file already has somewhere to land.
  const folderIdByPath = new Map<string, string | null>();
  if (destination.kind === 'lead') {
    const scope: DocumentFolderScope = {
      scopeType: 'lead',
      scopeKey: destination.leadNumber,
      classificationId: destination.classificationId,
      area: null,
    };
    for (const path of params.folderPaths || []) {
      const segments = path.split('/').filter(Boolean);
      if (segments.length === 0) continue;
      try {
        const folderId = await ensureFolderPath(scope, segments, undefined, {
          parentId: destination.folderId,
        });
        folderIdByPath.set(path, folderId);
        result.foldersCreated += 1;
      } catch (err) {
        console.warn('[documentDriveUpload] folder create failed for', path, err);
      }
    }
  }

  const folderForEntry = (entry: FolderUploadEntry): string | null => {
    if (destination.kind !== 'lead') return null;
    if (entry.segments.length === 0) return destination.folderId;
    const key = entry.segments.join('/');
    return folderIdByPath.get(key) ?? destination.folderId;
  };

  for (let index = 0; index < entries.length; index += 1) {
    const entry = entries[index];
    try {
      if (destination.kind === 'lead') {
        result.created.push(
          await uploadCaseDocument({
            destination,
            entry,
            folderId: folderForEntry(entry),
            uploadedBy,
          }),
        );
      } else if (destination.kind === 'staff_meeting') {
        result.created.push(
          await uploadStaffMeetingDocument({
            meetingId: destination.meetingId,
            file: entry.file,
            uploadedBy,
          }),
        );
      } else if (destination.kind === 'office') {
        const row = await uploadOfficeDocument({
          file: entry.file,
          folderId: destination.folderId,
          departmentId: destination.departmentId,
        });
        result.created.push({
          bucket: OFFICE_DOCUMENTS_BUCKET,
          storagePath: row.storage_path,
          fileName: row.file_name,
          mimeType: row.mime_type || entry.file.type,
        });
      } else {
        const row = await uploadEmployeePersonalFile({
          employeeId: destination.employeeId,
          file: entry.file,
        });
        result.created.push({
          bucket: EMPLOYEE_PERSONAL_FILES_BUCKET,
          storagePath: row.storage_path,
          fileName: row.file_name,
          mimeType: row.mime_type || entry.file.type,
        });
      }
      result.succeeded += 1;
    } catch (err: any) {
      result.failed += 1;
      result.lastError = String(err?.message || err || 'Upload failed');
      console.error('[documentDriveUpload]', entry.file.name, err);
    }
    params.onProgress?.(index + 1, entries.length);
  }

  return result;
}
