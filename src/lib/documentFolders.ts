import { expandLeadCaseDocumentLeadNumbers } from './leadCaseDocumentKeys';
import { supabase } from './supabase';

/**
 * Nestable document folders (`public.document_folders`), shared by the Case documents drawer and
 * the central documents page. Scope keeps the trees apart: for a lead it is the case number, for
 * the office space a single fixed key, and so on.
 *
 * Folder membership lives on the document row (`lead_case_documents.folder_id`). Storage object
 * paths are untouched, exactly like the sub-effort folders this replaces.
 */

export type DocumentFolderScopeType = 'lead' | 'office' | 'employee' | 'staff_meeting';

export type DocumentFolderScope = {
  scopeType: DocumentFolderScopeType;
  scopeKey: string;
  /**
   * Case documents tab a new folder is tagged with. Reading a case lists its whole tree whatever
   * the tab, as the drive does — see applyScope.
   */
  classificationId?: string | null;
  /** Mirrors `lead_case_documents.onedrive_subfolder`, and is likewise only written, not read. */
  area?: string | null;
};

export type DocumentFolder = {
  id: string;
  parent_id: string | null;
  scope_type: DocumentFolderScopeType;
  scope_key: string;
  classification_id: string | null;
  area: string | null;
  title: string;
  note: string | null;
  path: string;
  depth: number;
  sort_order: number;
  created_by: string | null;
  created_at: string;
  /** False hides the folder, and everything under it, from the client portal. */
  client_visible: boolean;
};

const FOLDER_SELECT =
  'id, parent_id, scope_type, scope_key, classification_id, area, title, note, path, depth, sort_order, created_by, created_at, client_visible';

/** Matches the depth guard in sql/2026-10-21_document_folders.sql. */
export const MAX_DOCUMENT_FOLDER_DEPTH = 10;

export const MAX_DOCUMENT_FOLDER_TITLE = 80;

/** A folder title is one path segment, so a slash would break the materialised path. */
export function normaliseFolderTitle(raw: string): string {
  return raw.replace(/[/\\]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, MAX_DOCUMENT_FOLDER_TITLE);
}

/**
 * The folders a scope reads. `.eq(col, null)` matches nothing in PostgREST, so nullable parts
 * need `.is`.
 *
 * A case has one tree, which is what the documents drive shows: its folders are read by case
 * number alone, with the tab and the area left out of the question. They have to be, because the
 * screens that make a case folder disagree about both columns while meaning the same folder —
 * the drive's New window writes no area and whichever classification the file it was filing
 * carried (a tab answers to several, once duplicate classifications are merged), the Case
 * documents drawer and the sub-effort modal write 'ClientHeaderDocuments' and the tab's
 * canonical id. Filtering on either hid drive-made folders from the drawer while still listing
 * the files inside them, which is the one thing a folder view must never do.
 *
 * Every spelling of the case number counts, since a folder is keyed by whichever spelling the
 * screen that made it held ('209994/3' from a legacy row, 'L209994/3' from the client page) —
 * the same expansion the documents themselves are read with.
 *
 * `classificationId` and `area` still say what a *new* folder is written with, so a tab's own
 * folders stay tagged with that tab.
 */
function applyScope(query: any, scope: DocumentFolderScope): any {
  if (scope.scopeType === 'lead') {
    return query
      .eq('scope_type', 'lead')
      .in('scope_key', expandLeadCaseDocumentLeadNumbers(scope.scopeKey));
  }

  const next = query.eq('scope_type', scope.scopeType).eq('scope_key', scope.scopeKey);
  const scoped = scope.classificationId
    ? next.eq('classification_id', scope.classificationId)
    : next.is('classification_id', null);
  return scope.area ? scoped.eq('area', scope.area) : scoped.is('area', null);
}

export async function listDocumentFolders(scope: DocumentFolderScope): Promise<DocumentFolder[]> {
  const { data, error } = await applyScope(
    supabase.from('document_folders').select(FOLDER_SELECT),
    scope,
  )
    .order('depth', { ascending: true })
    .order('sort_order', { ascending: true })
    .order('created_at', { ascending: true });

  if (error) throw error;
  return (data || []) as DocumentFolder[];
}

/** The scope a folder itself sits in, which is the scope anything under it must sit in too. */
async function parentScope(parentId: string): Promise<DocumentFolderScope | null> {
  const { data } = await supabase
    .from('document_folders')
    .select('scope_type, scope_key, classification_id, area')
    .eq('id', parentId)
    .maybeSingle();
  if (!data) return null;
  return {
    scopeType: data.scope_type as DocumentFolderScopeType,
    scopeKey: String(data.scope_key),
    classificationId: data.classification_id ?? null,
    area: data.area ?? null,
  };
}

async function nextSortOrder(scope: DocumentFolderScope, parentId: string | null): Promise<number> {
  let scoped = applyScope(supabase.from('document_folders').select('sort_order'), scope);
  scoped = parentId ? scoped.eq('parent_id', parentId) : scoped.is('parent_id', null);
  const { data } = await scoped.order('sort_order', { ascending: false }).limit(1);
  return (Number(data?.[0]?.sort_order) || 0) + 1;
}

/**
 * Children of one folder across every case, for the central documents page. Passing null lists
 * the top-level folders.
 */
export async function listFolderChildrenAcrossScopes(
  parentId: string | null,
  options: { scopeType?: DocumentFolderScopeType; scopeKey?: string | null; limit?: number } = {},
): Promise<DocumentFolder[]> {
  const limit = options.limit ?? 500;
  const scopeType = options.scopeType ?? 'lead';
  let query = supabase
    .from('document_folders')
    .select(FOLDER_SELECT)
    .eq('scope_type', scopeType);
  if (options.scopeKey) {
    // A case answers to every spelling of its number, as it does everywhere else.
    query =
      scopeType === 'lead'
        ? query.in('scope_key', expandLeadCaseDocumentLeadNumbers(options.scopeKey))
        : query.eq('scope_key', options.scopeKey);
  }
  query = parentId ? query.eq('parent_id', parentId) : query.is('parent_id', null);

  const { data, error } = await query
    .order('title', { ascending: true })
    .order('created_at', { ascending: true })
    .limit(limit);

  if (error) throw error;
  return (data || []) as DocumentFolder[];
}

export async function createDocumentFolder(params: {
  scope: DocumentFolderScope;
  title: string;
  parentId?: string | null;
  note?: string | null;
  createdBy?: string | null;
  createdByEmployeeId?: number | null;
}): Promise<DocumentFolder> {
  const title = normaliseFolderTitle(params.title);
  if (!title) throw new Error('Folder name is required');

  const parentId = params.parentId ?? null;
  const sortOrder = await nextSortOrder(params.scope, parentId);
  /*
   * A subfolder takes its parent's scope, not the caller's. The database insists the two match,
   * and a tab can now open a folder of the case that carries no tab of its own (see applyScope),
   * where a folder made from the caller's scope would be refused.
   */
  const scope = parentId ? ((await parentScope(parentId)) ?? params.scope) : params.scope;

  const { data, error } = await supabase
    .from('document_folders')
    .insert({
      parent_id: parentId,
      scope_type: scope.scopeType,
      scope_key: scope.scopeKey,
      classification_id: scope.classificationId ?? null,
      area: scope.area ?? null,
      title,
      note: params.note?.trim() || null,
      sort_order: sortOrder,
      created_by: params.createdBy ?? null,
      created_by_employee_id: params.createdByEmployeeId ?? null,
    })
    .select(FOLDER_SELECT)
    .single();

  if (error) throw error;
  return data as DocumentFolder;
}

export async function renameDocumentFolder(
  folderId: string,
  title: string,
  note?: string | null,
): Promise<DocumentFolder> {
  const nextTitle = normaliseFolderTitle(title);
  if (!nextTitle) throw new Error('Folder name is required');

  const patch: Record<string, unknown> = { title: nextTitle };
  if (note !== undefined) patch.note = note?.trim() || null;

  const { data, error } = await supabase
    .from('document_folders')
    .update(patch)
    .eq('id', folderId)
    .select(FOLDER_SELECT)
    .single();

  if (error) throw error;
  return data as DocumentFolder;
}

export async function moveDocumentFolder(
  folderId: string,
  parentId: string | null,
): Promise<DocumentFolder> {
  const { data, error } = await supabase
    .from('document_folders')
    .update({ parent_id: parentId })
    .eq('id', folderId)
    .select(FOLDER_SELECT)
    .single();

  if (error) throw error;
  return data as DocumentFolder;
}

/** Subfolders cascade; documents inside are unfiled rather than deleted. */
export async function deleteDocumentFolder(folderId: string): Promise<void> {
  const { error } = await supabase.from('document_folders').delete().eq('id', folderId);
  if (error) throw error;
}

export async function moveCaseDocumentsToFolder(
  documentIds: string[],
  folderId: string | null,
): Promise<void> {
  if (documentIds.length === 0) return;
  const { error } = await supabase
    .from('lead_case_documents')
    .update({ folder_id: folderId })
    .in('id', documentIds);
  if (error) throw error;
}

function findChild(
  folders: DocumentFolder[],
  parentId: string | null,
  title: string,
): DocumentFolder | undefined {
  const needle = title.toLowerCase();
  return folders.find(
    (folder) => (folder.parent_id ?? null) === parentId && folder.title.toLowerCase() === needle,
  );
}

/**
 * Creates any missing folders along `['passports', '2026']` and returns the leaf id, reusing
 * folders that already exist. Pass `known` (from `listDocumentFolders`) to save a round trip;
 * newly created folders are appended to it so repeated calls in one upload stay cheap.
 * `options.parentId` drops the tree inside an existing folder, for a drop while browsing one.
 */
export async function ensureFolderPath(
  scope: DocumentFolderScope,
  segments: string[],
  known?: DocumentFolder[],
  options?: { parentId?: string | null },
): Promise<string | null> {
  const titles = segments.map(normaliseFolderTitle).filter(Boolean);
  const base = options?.parentId ?? null;
  if (titles.length === 0) return base;

  const cache = known ?? (await listDocumentFolders(scope));
  let parentId: string | null = base;
  const baseDepth = base ? (cache.find((folder) => folder.id === base)?.depth ?? 0) + 1 : 0;

  for (const [index, title] of titles.entries()) {
    if (baseDepth + index >= MAX_DOCUMENT_FOLDER_DEPTH) break;

    const existing = findChild(cache, parentId, title);
    if (existing) {
      parentId = existing.id;
      continue;
    }

    try {
      const created = await createDocumentFolder({ scope, title, parentId });
      cache.push(created);
      parentId = created.id;
    } catch (error: any) {
      // Someone else created the same folder between our read and write.
      if (error?.code !== '23505') throw error;
      const refreshed = await listDocumentFolders(scope);
      cache.length = 0;
      cache.push(...refreshed);
      const found = findChild(cache, parentId, title);
      if (!found) throw error;
      parentId = found.id;
    }
  }

  return parentId;
}

/** Root-first chain down to `folderId`, for breadcrumbs. Empty when the id is unknown. */
export function folderTrail(folders: DocumentFolder[], folderId: string | null): DocumentFolder[] {
  if (!folderId) return [];
  const byId = new Map(folders.map((folder) => [folder.id, folder]));
  const trail: DocumentFolder[] = [];
  let current = byId.get(folderId);
  while (current) {
    trail.unshift(current);
    current = current.parent_id ? byId.get(current.parent_id) : undefined;
    if (trail.length > MAX_DOCUMENT_FOLDER_DEPTH + 1) break;
  }
  return trail;
}

export function childFolders(
  folders: DocumentFolder[],
  parentId: string | null,
): DocumentFolder[] {
  return folders.filter((folder) => (folder.parent_id ?? null) === (parentId ?? null));
}

/** Ids of `folderId` and everything beneath it, used when counting a folder's contents. */
export function folderSubtreeIds(folders: DocumentFolder[], folderId: string): string[] {
  const ids = [folderId];
  let frontier = [folderId];
  while (frontier.length > 0) {
    const next = folders
      .filter((folder) => folder.parent_id && frontier.includes(folder.parent_id))
      .map((folder) => folder.id)
      .filter((id) => !ids.includes(id));
    ids.push(...next);
    frontier = next;
  }
  return ids;
}
