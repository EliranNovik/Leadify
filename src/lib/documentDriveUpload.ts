import { supabase } from './supabase';
import {
  buildCaseDocumentStoragePath,
  buildStaffMeetingDocumentStoragePath,
  CASE_DOCUMENTS_STORAGE_BUCKET,
  resolveCaseDocumentUploadContentType,
} from './caseDocumentsStorage';
import { ensureFolderPath, type DocumentFolderScope } from './documentFolders';
import {
  ensureOfficeFolderPath,
  fetchOfficeDocumentFolders,
  OFFICE_DOCUMENTS_BUCKET,
  uploadOfficeDocument,
} from './officeDocuments';
import {
  EMPLOYEE_PERSONAL_FILES_BUCKET,
  ensureEmployeePersonalFolderPath,
  fetchEmployeePersonalFolders,
  uploadEmployeePersonalFile,
} from './employeePersonalSpace';
import type { FolderUploadEntry } from './browserFolderUpload';
import { deleteDocumentIndexRow, hasStoredFile, type DocumentIndexRow } from './documentIndex';

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
  | { kind: 'personal'; employeeId: number; folderId: string | null };

/**
 * Whether a dropped folder tree can be kept as it is. Meetings are the one destination that
 * stores no folders at all, so their files land in the meeting itself.
 */
export function destinationSupportsFolders(destination: DriveDestination): boolean {
  return destination.kind !== 'staff_meeting';
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
  /** Folder paths as segments, parents before children — what planFolderUpload() reports. */
  folderPaths?: string[][];
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

  // Folders first, so every file already has somewhere to land. Each store keeps its own folders,
  // so the tree is rebuilt through whichever one the destination belongs to.
  const baseFolderId = destination.kind === 'staff_meeting' ? null : destination.folderId;

  // Read once per upload: the ensure helpers add what they create to this, so a tree of any width
  // costs one read rather than one per path.
  const officeFolderCache =
    destination.kind === 'office'
      ? await fetchOfficeDocumentFolders(destination.departmentId).catch(() => [])
      : undefined;
  const personalFolderCache =
    destination.kind === 'personal'
      ? await fetchEmployeePersonalFolders(destination.employeeId).catch(() => [])
      : undefined;

  const ensurePath = async (segments: string[]): Promise<string | null> => {
    switch (destination.kind) {
      case 'lead': {
        const scope: DocumentFolderScope = {
          scopeType: 'lead',
          scopeKey: destination.leadNumber,
          classificationId: destination.classificationId,
          area: null,
        };
        return ensureFolderPath(scope, segments, undefined, { parentId: destination.folderId });
      }
      case 'office':
        return ensureOfficeFolderPath(destination.departmentId, segments, {
          parentId: destination.folderId,
          known: officeFolderCache,
        });
      case 'personal':
        return ensureEmployeePersonalFolderPath(destination.employeeId, segments, {
          parentId: destination.folderId,
          known: personalFolderCache,
        });
      default:
        return null;
    }
  };

  const folderIdByPath = new Map<string, string | null>();
  if (destinationSupportsFolders(destination)) {
    for (const path of params.folderPaths || []) {
      const segments = path.filter(Boolean);
      if (segments.length === 0) continue;
      try {
        folderIdByPath.set(segments.join('/'), await ensurePath(segments));
        result.foldersCreated += 1;
      } catch (err) {
        console.warn('[documentDriveUpload] folder create failed for', segments.join('/'), err);
      }
    }
  }

  const folderForEntry = (entry: FolderUploadEntry): string | null => {
    if (entry.segments.length === 0) return baseFolderId;
    const key = entry.segments.join('/');
    return folderIdByPath.get(key) ?? baseFolderId;
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
          folderId: folderForEntry(entry),
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
          folderId: folderForEntry(entry),
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

/** Copying leaves the original where it is; moving removes it once the copy is safely in place. */
export type DriveTransferMode = 'copy' | 'move';

export type DriveTransferResult = {
  succeeded: number;
  failed: number;
  /** Copies that landed but whose original could not be removed, so the file is now in both. */
  originalsKept: number;
  lastError: string | null;
};

/** Whether a document already sits exactly where it is being sent. */
export function isSameDrivePlace(row: DocumentIndexRow, destination: DriveDestination): boolean {
  const folder = row.folder_id ?? null;
  switch (destination.kind) {
    case 'lead':
      return (
        row.source === 'lead' &&
        row.scope_key === destination.leadNumber &&
        (row.classification_id ?? null) === destination.classificationId &&
        folder === destination.folderId
      );
    case 'staff_meeting':
      return row.source === 'staff_meeting' && row.scope_key === String(destination.meetingId);
    case 'office':
      return (
        row.source === 'office' &&
        row.scope_key ===
          (destination.departmentId != null ? `dept-${destination.departmentId}` : 'admins') &&
        folder === destination.folderId
      );
    case 'personal':
      return (
        row.source === 'personal' &&
        row.scope_key === String(destination.employeeId) &&
        folder === destination.folderId
      );
  }
}

async function fileFromStoredDocument(row: DocumentIndexRow): Promise<File> {
  if (!hasStoredFile(row)) throw new Error('This document has no stored file yet');
  const path = row.storage_path.trim();

  const { data, error } = await supabase.storage.from(row.storage_bucket).download(path);
  if (error) throw error;
  if (!data) throw new Error('Could not read the stored file');

  return new File([data], row.file_name, {
    type: row.mime_type || data.type || 'application/octet-stream',
    lastModified: Date.parse(row.created_at) || Date.now(),
  });
}

/**
 * Puts documents that are already in the drive somewhere else in it. The file is read back out of
 * its bucket and uploaded through the destination's own helper, so it lands in the right bucket,
 * table and folder exactly as a fresh upload would. A move only deletes the original after the
 * copy is in place, and says so when the delete is refused rather than losing the file.
 */
export async function transferDocumentsToDestination(params: {
  rows: DocumentIndexRow[];
  destination: DriveDestination;
  mode: DriveTransferMode;
  uploadedBy?: string | null;
  onProgress?: (done: number, total: number) => void;
}): Promise<DriveTransferResult> {
  const result: DriveTransferResult = {
    succeeded: 0,
    failed: 0,
    originalsKept: 0,
    lastError: null,
  };

  for (let index = 0; index < params.rows.length; index += 1) {
    const row = params.rows[index];
    try {
      const file = await fileFromStoredDocument(row);
      const upload = await uploadEntriesToDestination({
        destination: params.destination,
        entries: [{ file, segments: [] }],
        uploadedBy: params.uploadedBy ?? null,
      });
      if (upload.succeeded === 0) throw new Error(upload.lastError || 'Could not file the copy');

      if (params.mode === 'move') {
        try {
          await deleteDocumentIndexRow(row);
        } catch (err: any) {
          result.originalsKept += 1;
          result.lastError = String(err?.message || err || 'Could not remove the original');
        }
      }
      result.succeeded += 1;
    } catch (err: any) {
      result.failed += 1;
      result.lastError = String(err?.message || err || 'Could not copy this file');
      console.error('[documentDriveUpload] transfer', row.file_name, err);
    }
    params.onProgress?.(index + 1, params.rows.length);
  }

  return result;
}
