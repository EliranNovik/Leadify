import { supabase } from './supabase';

/**
 * Keeping a document's recorded size honest after its bytes are replaced in place, which is what
 * saving an edit from the document viewer does. Every list in the CRM reads the size from the row
 * rather than from storage, so without this a saved edit would keep showing the old size.
 */

type SizeColumn = { table: string; column: 'file_size' | 'size_bytes' };

/**
 * Which rows can point at an object in each bucket. Case documents and staff meeting documents
 * share a bucket, so both are tried and whichever owns the path is the one that updates.
 * `employee-hr-documents` is absent on purpose: those rows record no size.
 */
const SIZE_COLUMNS_BY_BUCKET: Record<string, SizeColumn[]> = {
  'lead-sub-efforts-documents': [
    { table: 'lead_case_documents', column: 'file_size' },
    { table: 'staff_meeting_documents', column: 'file_size' },
  ],
  'office-documents': [{ table: 'office_documents', column: 'size_bytes' }],
  'employee-personal-files': [{ table: 'employee_personal_files', column: 'size_bytes' }],
};

export function knowsStoredSizeFor(bucket: string): boolean {
  return (SIZE_COLUMNS_BY_BUCKET[bucket] || []).length > 0;
}

/**
 * The bytes storage holds right now, or null when they cannot be read.
 *
 * Signed afresh and fetched past every cache, because the whole point is to see the current file
 * rather than the one a CDN or a browser remembers.
 */
export async function fetchStoredObjectBytes(
  bucket: string,
  storagePath: string,
): Promise<Blob | null> {
  if (!bucket || !storagePath) return null;
  const { data, error } = await supabase.storage.from(bucket).createSignedUrl(storagePath, 60);
  if (error || !data?.signedUrl) {
    console.warn('Could not read the stored file:', error?.message || 'no signed URL');
    return null;
  }
  const response = await fetch(data.signedUrl, { cache: 'no-store' });
  if (!response.ok) {
    console.warn(`Could not read the stored file (HTTP ${response.status})`);
    return null;
  }
  return response.blob();
}

/**
 * What storage itself now holds for an object, in bytes, or null when it cannot be read.
 *
 * Used to prove an overwrite really landed: a write that RLS refused, or that went to a path
 * nobody reads, is otherwise indistinguishable from a successful save.
 */
export async function fetchStoredObjectSize(
  bucket: string,
  storagePath: string,
): Promise<number | null> {
  if (!bucket || !storagePath) return null;
  const cut = storagePath.lastIndexOf('/');
  const folder = cut >= 0 ? storagePath.slice(0, cut) : '';
  const name = cut >= 0 ? storagePath.slice(cut + 1) : storagePath;

  const { data, error } = await supabase.storage.from(bucket).list(folder, { search: name });
  if (error) {
    console.warn('Could not read the stored file size:', error.message);
    return null;
  }
  const match = (data || []).find((entry) => entry.name === name);
  const size = (match?.metadata as { size?: number } | null | undefined)?.size;
  return typeof size === 'number' ? size : null;
}

/** Best effort: the file itself is already saved, so a stale size must not fail the save. */
export async function syncStoredDocumentSize(
  bucket: string,
  storagePath: string,
  size: number,
): Promise<void> {
  const targets = SIZE_COLUMNS_BY_BUCKET[bucket] || [];
  if (targets.length === 0 || !storagePath || !Number.isFinite(size) || size < 0) return;

  await Promise.all(
    targets.map(async ({ table, column }) => {
      const { error } = await supabase
        .from(table)
        .update({ [column]: size })
        .eq('storage_path', storagePath);
      if (error) console.warn(`Could not update ${table}.${column} after an edit:`, error.message);
    }),
  );
}
