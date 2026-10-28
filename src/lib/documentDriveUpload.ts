import { supabase } from './supabase';
import {
  buildCaseDocumentStoragePath,
  buildStaffMeetingDocumentStoragePath,
  CASE_DOCUMENTS_STORAGE_BUCKET,
  resolveCaseDocumentUploadContentType,
} from './caseDocumentsStorage';
import { ensureFolderPath, type DocumentFolderScope } from './documentFolders';
import {
  buildOfficeDocumentStoragePath,
  ensureOfficeFolderPath,
  fetchOfficeDocumentFolders,
  OFFICE_DOCUMENTS_BUCKET,
  uploadOfficeDocument,
} from './officeDocuments';
import {
  buildEmployeePersonalFileStoragePath,
  EMPLOYEE_PERSONAL_FILES_BUCKET,
  ensureEmployeePersonalFolderPath,
  fetchEmployeePersonalFolders,
  uploadEmployeePersonalFile,
} from './employeePersonalSpace';
import type { FolderUploadEntry } from './browserFolderUpload';
import {
  deleteDocumentIndexRow,
  documentIndexSourceTable,
  hasStoredFile,
  type DocumentIndexRow,
  type DocumentIndexSource,
} from './documentIndex';
import {
  autoCaseSummariesEnabled,
  BULK_SUMMARY_FILE_LIMIT,
  caseDocumentSummaryFields,
} from './caseDocumentSummaryPolicy';

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

/**
 * How many files are uploaded at once. One at a time, a batch spends nearly all of its time
 * waiting on a round trip; six lanes keep the connection busy without flooding the browser's own
 * request pool, which is what the case drawer settled on.
 */
const DRIVE_UPLOAD_CONCURRENCY = 6;

const RETRY_PAUSE_MS = 600;

function pause(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Rate limits and gateway errors turn up only once requests overlap, and they clear on a retry. */
function isTransientStorageError(error: unknown): boolean {
  const err = error as { statusCode?: string | number; status?: number; message?: string } | null;
  const status = Number(err?.statusCode ?? err?.status ?? 0);
  if (status === 429 || (status >= 500 && status < 600)) return true;
  const message = String(err?.message ?? '').toLowerCase();
  return (
    message.includes('too many requests') ||
    message.includes('failed to fetch') ||
    message.includes('load failed')
  );
}

/**
 * One more go at anything that failed for a reason that is nobody's fault. Safe for the office and
 * personal upload helpers, which remove their file and throw before leaving a row behind.
 */
async function withTransientRetry<T>(run: () => Promise<T>): Promise<T> {
  try {
    return await run();
  } catch (error) {
    if (!isTransientStorageError(error)) throw error;
    await pause(RETRY_PAUSE_MS);
    return run();
  }
}

/**
 * Puts the bytes in the bucket and says where they landed, which is not always where they were
 * sent: a path already taken is retried under a suffixed one.
 */
async function putObject(
  bucket: string,
  path: string,
  file: File,
  contentType: string,
): Promise<string> {
  const attempt = (target: string) =>
    supabase.storage.from(bucket).upload(target, file, { contentType, upsert: false });

  let target = path;
  let { error } = await attempt(target);

  if (error && isDuplicateStorageObject(error)) {
    target = withUniqueBasename(target);
    ({ error } = await attempt(target));
  }
  if (error && isTransientStorageError(error)) {
    await pause(RETRY_PAUSE_MS);
    ({ error } = await attempt(target));
  }
  if (error) throw error;
  return target;
}

async function uploadCaseDocument(params: {
  destination: Extract<DriveDestination, { kind: 'lead' }>;
  entry: FolderUploadEntry;
  folderId: string | null;
  uploadedBy: string | null;
  /** False for a big batch, which leaves the summaries to be asked for later. */
  summarise: boolean;
}): Promise<DriveCreatedFile> {
  const { file } = params.entry;
  const contentType = resolveCaseDocumentUploadContentType(file);
  const storagePath = await putObject(
    CASE_DOCUMENTS_STORAGE_BUCKET,
    buildCaseDocumentStoragePath(params.destination.leadNumber, null, file.name),
    file,
    contentType,
  );

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
    ...caseDocumentSummaryFields(params.summarise),
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
  const storagePath = await putObject(
    CASE_DOCUMENTS_STORAGE_BUCKET,
    buildStaffMeetingDocumentStoragePath(params.meetingId, file.name),
    file,
    contentType,
  );

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
  /** How many of the successes took the place of a document already there, not a separate count. */
  replaced: number;
  /** Clashing files left alone on the uploader's say-so. */
  skipped: number;
  lastError: string | null;
  foldersCreated: number;
  /** In the order they were uploaded, for the ones that worked. */
  created: DriveCreatedFile[];
};

/** What to do with a file whose name is already taken where it is going. */
export type DriveClashChoice = 'replace' | 'skip';

/** A file in the batch that would land on top of a name already in use. */
export type DriveUploadClash = {
  /** Its place in the entries that were handed in, which is how the answer comes back. */
  index: number;
  fileName: string;
  /** The folder inside the drop it came from, empty when it was dropped at the top. */
  folderLabel: string;
  incomingSize: number;
  existingSize: number | null;
  existingCreatedAt: string;
};

/** A document already stored where something in the batch is about to land. */
type ExistingDocument = {
  rowId: string;
  fileName: string;
  bucket: string;
  storagePath: string;
  fileSize: number | null;
  createdAt: string;
};

/** Which section of the drive a destination writes into, as `document_index` reports it. */
function destinationSource(destination: DriveDestination): DocumentIndexSource {
  switch (destination.kind) {
    case 'lead':
      return 'lead';
    case 'staff_meeting':
      return 'staff_meeting';
    case 'office':
      return 'office';
    case 'personal':
      return 'personal';
  }
}

/** Case-insensitive, because two names differing only in case read as the same document. */
function clashKey(folderId: string | null, fileName: string): string {
  return `${folderId ?? 'root'}::${fileName.trim().toLowerCase()}`;
}

/** How many stored rows the name check reads. Past this a clash simply goes unnoticed. */
const EXISTING_NAME_SCAN_LIMIT = 5000;

/** Which bucket a destination's files are kept in, since its own table does not say. */
function destinationBucket(destination: DriveDestination): string {
  switch (destination.kind) {
    case 'office':
      return OFFICE_DOCUMENTS_BUCKET;
    case 'personal':
      return EMPLOYEE_PERSONAL_FILES_BUCKET;
    default:
      return CASE_DOCUMENTS_STORAGE_BUCKET;
  }
}

/**
 * The documents already filed in the folders this batch is about to write into, read once for the
 * whole batch rather than once per file.
 *
 * Read from the store's own table rather than through the `document_index` view: the view unions
 * five tables and builds every space's folder paths with a recursive query before any filter
 * applies, which is seconds of waiting before the first byte goes up. Here one folder's names are
 * wanted, off an indexed column.
 */
async function fetchExistingDocuments(
  destination: DriveDestination,
  folderIds: Array<string | null>,
): Promise<Map<string, ExistingDocument>> {
  const found = new Map<string, ExistingDocument>();
  const bucket = destinationBucket(destination);
  // Office and personal keep their own tables, which name the size column differently. Meetings
  // hold one flat list, so they have no folder column at all.
  const sizeColumn =
    destination.kind === 'office' || destination.kind === 'personal' ? 'size_bytes' : 'file_size';
  const keepsFolders = destination.kind !== 'staff_meeting';
  const columns = [
    'id',
    'file_name',
    'storage_path',
    `${sizeColumn}`,
    'created_at',
    ...(keepsFolders ? ['folder_id'] : []),
  ].join(', ');

  const place = () => {
    const request = supabase
      .from(documentIndexSourceTable(destinationSource(destination)))
      .select(columns)
      .not('storage_path', 'is', null)
      .limit(EXISTING_NAME_SCAN_LIMIT);

    switch (destination.kind) {
      case 'lead':
        // A case keeps a separate tree per document type, so the same name under another type is
        // another place entirely — exactly as `isSameDrivePlace` reads it.
        return request
          .eq('lead_number', destination.leadNumber)
          .eq('classification_id', destination.classificationId);
      case 'staff_meeting':
        return request.eq('meeting_id', destination.meetingId);
      case 'office':
        return destination.departmentId == null
          ? request.is('department_id', null)
          : request.eq('department_id', destination.departmentId);
      case 'personal':
        return request.eq('employee_id', destination.employeeId);
    }
  };

  const named = Array.from(new Set(folderIds.filter((id): id is string => !!id)));
  const includeRoot = folderIds.some((id) => !id);

  const reads: Array<PromiseLike<{ data: any[] | null; error: { message?: string } | null }>> = [];
  if (!keepsFolders) {
    reads.push(place());
  } else {
    if (named.length > 0) reads.push(place().in('folder_id', named));
    if (includeRoot) reads.push(place().is('folder_id', null));
  }

  for (const { data, error } of await Promise.all(reads)) {
    if (error) throw error;
    for (const row of (data || []) as any[]) {
      const fileName = String(row.file_name || '');
      const storagePath = String(row.storage_path || '');
      if (!fileName || !storagePath || storagePath === 'pending') continue;

      const key = clashKey(row.folder_id != null ? String(row.folder_id) : null, fileName);
      const createdAt = String(row.created_at || '');
      // A folder can already hold the same name twice; replacing means replacing the newest.
      const seen = found.get(key);
      if (seen && Date.parse(seen.createdAt) >= Date.parse(createdAt)) continue;

      found.set(key, {
        rowId: String(row.id),
        fileName,
        bucket,
        storagePath,
        fileSize: row[sizeColumn] != null ? Number(row[sizeColumn]) : null,
        createdAt,
      });
    }
  }

  return found;
}

/**
 * Swaps the file behind a document that is already listed, keeping the row it is listed as.
 *
 * The row's id is what shares, links, its folder and its type all hang off, so a replacement
 * repoints it rather than adding a second document. The new bytes go up first and the old ones are
 * removed last: a failure in between leaves the document readable, pointing at one of the two.
 */
async function replaceExistingDocument(params: {
  destination: DriveDestination;
  existing: ExistingDocument;
  entry: FolderUploadEntry;
  uploadedBy: string | null;
  summarise: boolean;
}): Promise<DriveCreatedFile> {
  const { destination, existing } = params;
  const { file } = params.entry;
  // Named for the case drawer but general: the browser's own type, or the name when it has none.
  const contentType = resolveCaseDocumentUploadContentType(file);

  const target = (): { bucket: string; path: string } => {
    switch (destination.kind) {
      case 'lead':
        return {
          bucket: CASE_DOCUMENTS_STORAGE_BUCKET,
          path: buildCaseDocumentStoragePath(destination.leadNumber, null, file.name),
        };
      case 'staff_meeting':
        return {
          bucket: CASE_DOCUMENTS_STORAGE_BUCKET,
          path: buildStaffMeetingDocumentStoragePath(destination.meetingId, file.name),
        };
      case 'office':
        return {
          bucket: OFFICE_DOCUMENTS_BUCKET,
          path: buildOfficeDocumentStoragePath(file.name, destination.departmentId),
        };
      case 'personal':
        return {
          bucket: EMPLOYEE_PERSONAL_FILES_BUCKET,
          path: buildEmployeePersonalFileStoragePath(destination.employeeId, file.name),
        };
    }
  };

  const { bucket, path } = target();
  const storagePath = await putObject(bucket, path, file, contentType);

  // The two stores that keep their own tables name the size column differently, and only the two
  // case-shaped ones record who uploaded a file.
  const patch: Record<string, unknown> =
    destination.kind === 'lead'
      ? {
          storage_path: storagePath,
          file_size: file.size,
          mime_type: contentType,
          uploaded_by: params.uploadedBy,
          // The summary on hand describes a file that is about to be gone.
          ai_summary: null,
          ai_summary_at: null,
          ...caseDocumentSummaryFields(params.summarise),
        }
      : destination.kind === 'staff_meeting'
        ? {
            storage_path: storagePath,
            file_size: file.size,
            mime_type: contentType,
            uploaded_by: params.uploadedBy,
          }
        : { storage_path: storagePath, size_bytes: file.size, mime_type: contentType };

  // RLS answers a forbidden update with nought rows rather than an error, so without reading back
  // what changed this would report a replacement that never happened.
  const { data, error } = await supabase
    .from(documentIndexSourceTable(destinationSource(destination)))
    .update(patch)
    .eq('id', existing.rowId)
    .select('id');

  if (error || !data || data.length === 0) {
    await supabase.storage.from(bucket).remove([storagePath]);
    throw new Error(error?.message || 'This document is not yours to replace');
  }

  if (existing.bucket && existing.storagePath !== storagePath) {
    const { error: removeError } = await supabase.storage
      .from(existing.bucket)
      .remove([existing.storagePath]);
    if (removeError) {
      console.warn('[documentDriveUpload] replaced file kept', existing.storagePath, removeError);
    }
  }

  return { bucket, storagePath, fileName: file.name, mimeType: contentType };
}

export async function uploadEntriesToDestination(params: {
  destination: DriveDestination;
  entries: FolderUploadEntry[];
  /** Folder paths as segments, parents before children — what planFolderUpload() reports. */
  folderPaths?: string[][];
  uploadedBy?: string | null;
  onProgress?: (done: number, total: number) => void;
  /**
   * The files being sent right now, which a bar cannot show: storage reports nothing about a file
   * until it is done, so one large file in the batch looks like a stall unless it is named.
   */
  onActive?: (files: Array<{ name: string; size: number }>) => void;
  /**
   * Asked once, after everything whose name was free has landed, what to do about the names that
   * were taken. Without it a clashing file simply lands beside the one already there, as before.
   */
  onClashes?: (clashes: DriveUploadClash[]) => Promise<Map<number, DriveClashChoice>>;
}): Promise<DriveUploadResult> {
  const { destination, entries } = params;
  const uploadedBy = params.uploadedBy?.trim() || null;
  const result: DriveUploadResult = {
    succeeded: 0,
    failed: 0,
    replaced: 0,
    skipped: 0,
    lastError: null,
    foldersCreated: 0,
    created: [],
  };
  if (entries.length === 0) return result;

  // Small enough a batch to summarise as it arrives, and uploads allowed to summarise at all.
  const summarise =
    entries.length <= BULK_SUMMARY_FILE_LIMIT && (await autoCaseSummariesEnabled());

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

  // Worked out once up front: the folder each file is going into, and a slot for where it ended
  // up. Kept in the order handed in, because the drive opens the document it just uploaded.
  const targets = entries.map((entry) => folderForEntry(entry));
  const created: Array<DriveCreatedFile | null> = entries.map(() => null);

  let completed = 0;
  const reportProgress = () => {
    completed += 1;
    params.onProgress?.(completed, entries.length);
  };

  const inFlight = new Set<number>();
  const reportActive = () => {
    params.onActive?.(
      Array.from(inFlight).map((index) => ({
        name: entries[index].file.name,
        size: entries[index].file.size,
      })),
    );
  };

  /** Wraps the work on one file so it shows up as in flight for as long as it takes. */
  const whileSending = async (index: number, send: () => Promise<void>): Promise<void> => {
    inFlight.add(index);
    reportActive();
    try {
      await send();
    } finally {
      inFlight.delete(index);
      reportActive();
    }
  };

  const sendOne = async (index: number): Promise<void> => {
    const entry = entries[index];
    try {
      if (destination.kind === 'lead') {
        created[index] = await uploadCaseDocument({
          destination,
          entry,
          folderId: targets[index],
          uploadedBy,
          summarise,
        });
      } else if (destination.kind === 'staff_meeting') {
        created[index] = await uploadStaffMeetingDocument({
          meetingId: destination.meetingId,
          file: entry.file,
          uploadedBy,
        });
      } else if (destination.kind === 'office') {
        const row = await withTransientRetry(() =>
          uploadOfficeDocument({
            file: entry.file,
            folderId: targets[index],
            departmentId: destination.departmentId,
          }),
        );
        created[index] = {
          bucket: OFFICE_DOCUMENTS_BUCKET,
          storagePath: row.storage_path,
          fileName: row.file_name,
          mimeType: row.mime_type || entry.file.type,
        };
      } else {
        const row = await withTransientRetry(() =>
          uploadEmployeePersonalFile({
            employeeId: destination.employeeId,
            file: entry.file,
            folderId: targets[index],
          }),
        );
        created[index] = {
          bucket: EMPLOYEE_PERSONAL_FILES_BUCKET,
          storagePath: row.storage_path,
          fileName: row.file_name,
          mimeType: row.mime_type || entry.file.type,
        };
      }
      result.succeeded += 1;
    } catch (err: any) {
      result.failed += 1;
      result.lastError = String(err?.message || err || 'Upload failed');
      console.error('[documentDriveUpload]', entry.file.name, err);
    }
    reportProgress();
  };

  const uploadOne = (index: number) => whileSending(index, () => sendOne(index));

  const replaceOne = async (index: number, existing: ExistingDocument): Promise<void> => {
    try {
      created[index] = await replaceExistingDocument({
        destination,
        existing,
        entry: entries[index],
        uploadedBy,
        summarise,
      });
      result.succeeded += 1;
      result.replaced += 1;
    } catch (err: any) {
      result.failed += 1;
      result.lastError = String(err?.message || err || 'Could not replace this file');
      console.error('[documentDriveUpload] replace', entries[index].file.name, err);
    }
    reportProgress();
  };

  /** A few at a time, which is what turns a large batch from minutes into seconds. */
  const runInLanes = async (indexes: number[], work: (index: number) => Promise<void>) => {
    let cursor = 0;
    await Promise.all(
      Array.from({ length: Math.min(DRIVE_UPLOAD_CONCURRENCY, indexes.length) }, async () => {
        while (cursor < indexes.length) {
          const next = indexes[cursor];
          cursor += 1;
          await work(next);
        }
      }),
    );
  };

  // Names already taken are found before anything goes up, so nothing is sent twice, but the
  // question is held back until the rest has landed. A check that fails is no reason to stop:
  // without it this behaves as it always did and files land beside their namesakes.
  const alreadyThere = params.onClashes
    ? await fetchExistingDocuments(destination, targets).catch((err) => {
        console.warn('[documentDriveUpload] duplicate name check skipped:', err);
        return new Map<string, ExistingDocument>();
      })
    : new Map<string, ExistingDocument>();

  const clashes: DriveUploadClash[] = [];
  const clashingWith = new Map<number, ExistingDocument>();
  const claimed = new Set<string>();
  entries.forEach((entry, index) => {
    const match = alreadyThere.get(clashKey(targets[index], entry.file.name));
    // Two files of the same name inside one drop can only replace the one document between them,
    // so the second goes up as a new document rather than undoing the first.
    if (!match || claimed.has(match.rowId)) return;
    claimed.add(match.rowId);
    clashingWith.set(index, match);
    clashes.push({
      index,
      fileName: entry.file.name,
      folderLabel: entry.segments.join(' / '),
      incomingSize: entry.file.size,
      existingSize: match.fileSize,
      existingCreatedAt: match.createdAt,
    });
  });

  // Biggest first, so the one file that takes a minute runs alongside the hundred that take a
  // second rather than on its own at the end. The order files were handed in is kept by index.
  const queue = entries
    .map((_, index) => index)
    .filter((index) => !clashingWith.has(index))
    .sort((left, right) => entries[right].file.size - entries[left].file.size);

  await runInLanes(queue, uploadOne);

  if (clashes.length > 0 && params.onClashes) {
    const choices = await params.onClashes(clashes);
    const replacing = clashes.filter((clash) => choices.get(clash.index) === 'replace');
    result.skipped = clashes.length - replacing.length;
    // The files left alone are finished with as far as the progress bar is concerned.
    for (let left = 0; left < result.skipped; left += 1) reportProgress();
    await runInLanes(
      replacing.map((clash) => clash.index),
      (index) => whileSending(index, () => replaceOne(index, clashingWith.get(index)!)),
    );
  }

  result.created = created.filter((file): file is DriveCreatedFile => file !== null);
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
