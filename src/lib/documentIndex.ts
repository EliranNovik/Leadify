import { supabase } from './supabase';

/**
 * Reads of `public.document_index` (sql/2026-10-21_document_index_view.sql), the one view behind
 * the central documents page. The view is security_invoker, so what comes back is already limited
 * to what the signed-in person may see.
 */

export type DocumentIndexSource = 'lead' | 'staff_meeting' | 'office' | 'personal' | 'hr';

export const DOCUMENT_INDEX_SOURCES: DocumentIndexSource[] = [
  'lead',
  'staff_meeting',
  'office',
  'personal',
  'hr',
];

export const DOCUMENT_SOURCE_LABELS: Record<DocumentIndexSource, string> = {
  lead: 'Cases',
  staff_meeting: 'Meetings',
  office: 'Office',
  personal: 'My space',
  hr: 'HR',
};

export type DocumentIndexRow = {
  source: DocumentIndexSource;
  row_id: string;
  file_name: string;
  storage_bucket: string;
  storage_path: string;
  mime_type: string | null;
  file_size: number | null;
  uploaded_by: string | null;
  created_at: string;
  folder_id: string | null;
  folder_path: string | null;
  scope_key: string | null;
  scope_label: string | null;
  category: string | null;
  ai_summary: string | null;
  /** Set for case documents only — the folder tree is keyed by these. */
  classification_id: string | null;
  area: string | null;
};

export type DocumentIndexSort = 'created_at' | 'file_name' | 'file_size' | 'scope_label';

/** 'any' ignores folders entirely, 'root' keeps only unfiled documents. */
export type DocumentIndexFolderFilter = 'any' | 'root' | { id: string };

/** What the top bar narrows the list by, in every section and on the case list alike. */
export type DocumentIndexFilters = {
  search?: string;
  /** A `category` label exactly as the view reports it, e.g. a case document type. */
  category?: string | null;
  /** Inclusive calendar days (yyyy-mm-dd) read in the browser's own timezone. */
  createdFrom?: string | null;
  createdTo?: string | null;
};

export type DocumentIndexQuery = DocumentIndexFilters & {
  sources?: DocumentIndexSource[];
  /** One scope, or several when a space answers to more than one key. */
  scopeKey?: string | string[] | null;
  folder?: DocumentIndexFolderFilter;
  sort?: DocumentIndexSort;
  ascending?: boolean;
  page?: number;
  pageSize?: number;
};

export const DOCUMENT_INDEX_PAGE_SIZE = 50;

const ROW_SELECT =
  'source, row_id, file_name, storage_bucket, storage_path, mime_type, file_size, uploaded_by, created_at, folder_id, folder_path, scope_key, scope_label, category, ai_summary, classification_id, area';

/**
 * PostgREST's `or` filter is itself comma and bracket delimited, so those characters in a search
 * term would be read as more filters.
 */
export function sanitiseSearchTerm(raw: string): string {
  return raw.replace(/[,()*\\]/g, ' ').replace(/\s+/g, ' ').trim();
}

const MAX_SEARCH_TOKENS = 6;

/**
 * File names use underscores, dots and dashes where people type spaces, so the term is matched
 * word by word instead of as one string. "amir cohen" and "amir_cohen" then find the same files.
 */
export function searchTokens(raw: string): string[] {
  return sanitiseSearchTerm(raw)
    .split(/[\s_\-.]+/)
    .map((token) => token.trim())
    .filter(Boolean)
    .slice(0, MAX_SEARCH_TOKENS);
}

const SEARCHED_COLUMNS = ['file_name', 'scope_label', 'folder_path', 'category'];

/** Each token must appear somewhere, which chained `or` groups express as an AND of ORs. */
function applySearch<T>(request: T, raw: string | undefined): T {
  const tokens = searchTokens(raw || '');
  let next = request as any;
  for (const token of tokens) {
    next = next.or(SEARCHED_COLUMNS.map((column) => `${column}.ilike.%${token}%`).join(','));
  }
  return next as T;
}

/** A day in the browser's timezone, as the timestamp the column is stored in. */
function dayBoundaryIso(day: string, addDays = 0): string | null {
  const parsed = new Date(`${day}T00:00:00`);
  if (Number.isNaN(parsed.getTime())) return null;
  parsed.setDate(parsed.getDate() + addDays);
  return parsed.toISOString();
}

/** Search plus the top bar's category and date range, shared by every count and list query. */
function applyFilters<T>(request: T, filters: DocumentIndexFilters): T {
  let next = applySearch(request, filters.search) as any;
  if (filters.category) next = next.eq('category', filters.category);
  const from = filters.createdFrom ? dayBoundaryIso(filters.createdFrom) : null;
  if (from) next = next.gte('created_at', from);
  // The "to" day is included, so the cut is the start of the day after it.
  const to = filters.createdTo ? dayBoundaryIso(filters.createdTo, 1) : null;
  if (to) next = next.lt('created_at', to);
  return next as T;
}

export function hasDocumentIndexFilters(filters: DocumentIndexFilters): boolean {
  return (
    searchTokens(filters.search || '').length > 0 ||
    !!filters.category ||
    !!filters.createdFrom ||
    !!filters.createdTo
  );
}

export function stableRowKey(row: DocumentIndexRow): string {
  return `${row.source}:${row.row_id}`;
}

export async function fetchDocumentIndex(
  query: DocumentIndexQuery = {},
): Promise<{ rows: DocumentIndexRow[]; total: number }> {
  const pageSize = query.pageSize ?? DOCUMENT_INDEX_PAGE_SIZE;
  const page = Math.max(0, query.page ?? 0);
  const sort = query.sort ?? 'created_at';
  const ascending = query.ascending ?? false;

  let request = supabase.from('document_index').select(ROW_SELECT, { count: 'exact' });

  if (query.sources && query.sources.length > 0 && query.sources.length < DOCUMENT_INDEX_SOURCES.length) {
    request = request.in('source', query.sources);
  }
  if (Array.isArray(query.scopeKey)) {
    if (query.scopeKey.length > 0) request = request.in('scope_key', query.scopeKey);
  } else if (query.scopeKey) {
    request = request.eq('scope_key', query.scopeKey);
  }
  if (query.folder === 'root') {
    request = request.is('folder_id', null);
  } else if (query.folder && typeof query.folder === 'object') {
    request = request.eq('folder_id', query.folder.id);
  }

  request = applyFilters(request, query);

  const from = page * pageSize;
  const { data, error, count } = await request
    .order(sort, { ascending, nullsFirst: false })
    .order('row_id', { ascending: true })
    .range(from, from + pageSize - 1);

  if (error) throw error;
  return { rows: (data || []) as DocumentIndexRow[], total: count ?? 0 };
}

/** Per-source totals for the filter chips, counted without pulling any rows. */
export async function fetchDocumentIndexCounts(
  filters: DocumentIndexFilters = {},
): Promise<Record<DocumentIndexSource, number>> {
  const counts = {} as Record<DocumentIndexSource, number>;

  await Promise.all(
    DOCUMENT_INDEX_SOURCES.map(async (source) => {
      const request = applyFilters(
        supabase
          .from('document_index')
          .select('row_id', { count: 'exact', head: true })
          .eq('source', source),
        filters,
      );
      const { count } = await request;
      counts[source] = count ?? 0;
    }),
  );

  return counts;
}

/**
 * How many recent rows the category list is read from. A store larger than this only offers the
 * categories its recent documents use, which is what the filter is for in practice.
 */
const CATEGORY_SCAN_LIMIT = 1000;

/** The categories on offer in the filter, for the section currently open. */
export async function fetchDocumentIndexCategories(
  query: { sources?: DocumentIndexSource[]; scopeKey?: string | string[] | null } = {},
): Promise<string[]> {
  let request = supabase.from('document_index').select('category');

  if (query.sources && query.sources.length > 0 && query.sources.length < DOCUMENT_INDEX_SOURCES.length) {
    request = request.in('source', query.sources);
  }
  if (Array.isArray(query.scopeKey)) {
    if (query.scopeKey.length > 0) request = request.in('scope_key', query.scopeKey);
  } else if (query.scopeKey) {
    request = request.eq('scope_key', query.scopeKey);
  }

  const { data, error } = await request
    .order('created_at', { ascending: false, nullsFirst: false })
    .limit(CATEGORY_SCAN_LIMIT);
  if (error) throw error;

  const seen = new Set<string>();
  for (const row of (data || []) as { category: string | null }[]) {
    const label = (row.category || '').trim();
    if (label) seen.add(label);
  }
  return [...seen].sort((a, b) => a.localeCompare(b));
}

export type DocumentIndexCase = {
  lead_number: string;
  file_count: number;
  last_added: string | null;
};

/** How many matching cases a search will resolve before it stops looking. */
const CASE_SEARCH_SCAN_LIMIT = 1000;

/** Cases whose documents match the filters, so narrowing still lands you on a case folder. */
async function caseKeysMatchingFilters(filters: DocumentIndexFilters): Promise<string[]> {
  const request = applyFilters(
    supabase.from('document_index').select('scope_key').eq('source', 'lead'),
    filters,
  );
  const { data, error } = await request.limit(CASE_SEARCH_SCAN_LIMIT);
  if (error) throw error;

  const keys: string[] = [];
  const seen = new Set<string>();
  for (const row of (data || []) as { scope_key: string | null }[]) {
    const key = (row.scope_key || '').trim();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    keys.push(key);
  }
  return keys;
}

/** The cases that hold documents, so the Cases section can browse one case at a time. */
export async function fetchDocumentIndexCases(
  query: DocumentIndexFilters & { page?: number; pageSize?: number } = {},
): Promise<{ rows: DocumentIndexCase[]; total: number }> {
  const pageSize = query.pageSize ?? DOCUMENT_INDEX_PAGE_SIZE;
  const page = Math.max(0, query.page ?? 0);

  let request = supabase
    .from('document_index_cases')
    .select('lead_number, file_count, last_added', { count: 'exact' });

  // The case list is an aggregate, so narrowing it means resolving which cases still match.
  if (hasDocumentIndexFilters(query)) {
    const keys = await caseKeysMatchingFilters(query);
    if (keys.length === 0) return { rows: [], total: 0 };
    request = request.in('lead_number', keys);
  }

  const from = page * pageSize;
  const { data, error, count } = await request
    .order('last_added', { ascending: false, nullsFirst: false })
    .range(from, from + pageSize - 1);

  if (error) throw error;
  return { rows: (data || []) as DocumentIndexCase[], total: count ?? 0 };
}

/** Every document filed directly in one folder, for bulk download and the viewer. */
export async function fetchDocumentsInFolder(
  folderId: string,
  limit = 300,
): Promise<DocumentIndexRow[]> {
  const { data, error } = await supabase
    .from('document_index')
    .select(ROW_SELECT)
    .eq('folder_id', folderId)
    .order('file_name', { ascending: true })
    .limit(limit);

  if (error) throw error;
  return (data || []) as DocumentIndexRow[];
}

const SIGNED_URL_SECONDS = 60 * 60;

export async function createDocumentIndexSignedUrl(row: DocumentIndexRow): Promise<string> {
  const { data, error } = await supabase.storage
    .from(row.storage_bucket)
    .createSignedUrl(row.storage_path, SIGNED_URL_SECONDS);
  if (error) throw error;
  const url = data?.signedUrl?.trim();
  if (!url) throw new Error('Could not create a download link');
  return url;
}

/** One signing call per bucket, keyed by storage path. Missing entries simply failed to sign. */
export async function createDocumentIndexSignedUrls(
  rows: DocumentIndexRow[],
): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  const byBucket = new Map<string, string[]>();
  for (const row of rows) {
    if (!row.storage_path) continue;
    const paths = byBucket.get(row.storage_bucket) || [];
    paths.push(row.storage_path);
    byBucket.set(row.storage_bucket, paths);
  }

  await Promise.all(
    [...byBucket.entries()].map(async ([bucket, paths]) => {
      const { data, error } = await supabase.storage
        .from(bucket)
        .createSignedUrls([...new Set(paths)], SIGNED_URL_SECONDS);
      if (error || !data) return;
      for (const entry of data) {
        if (entry.path && entry.signedUrl) out.set(entry.path, entry.signedUrl);
      }
    }),
  );

  return out;
}

export function formatDocumentSize(bytes: number | null): string {
  if (bytes == null || !Number.isFinite(bytes) || bytes <= 0) return '—';
  const units = ['B', 'KB', 'MB', 'GB'];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value >= 10 || unit === 0 ? Math.round(value) : value.toFixed(1)} ${units[unit]}`;
}

/** Only case documents live in the shared folder tree, so only those can be moved or restricted. */
export function isMovableDocument(row: DocumentIndexRow): boolean {
  return row.source === 'lead';
}

/**
 * The table each source is read from. The view reports every `row_id` as that table's own id, so
 * this is all a row needs to be deleted.
 */
const DOCUMENT_SOURCE_TABLES: Record<DocumentIndexSource, string> = {
  lead: 'lead_case_documents',
  staff_meeting: 'staff_meeting_documents',
  office: 'office_documents',
  personal: 'employee_personal_files',
  hr: 'employee_hr_documents',
};

export function documentIndexSourceTable(source: DocumentIndexSource): string {
  return DOCUMENT_SOURCE_TABLES[source];
}

/**
 * Removes a document for good. The row goes first and the stored file after: a stranded file is
 * invisible and only costs space, while a row left pointing at a deleted file keeps listing and
 * fails to open. Each table's own delete policy still decides whether this is allowed.
 */
export async function deleteDocumentIndexRow(row: DocumentIndexRow): Promise<void> {
  const table = documentIndexSourceTable(row.source);
  if (!table) throw new Error('This document cannot be deleted from here');

  // RLS turns a forbidden delete into nought rows rather than an error, so without reading back
  // what went the page would report a file as deleted while it is still there.
  const { data, error } = await supabase.from(table).delete().eq('id', row.row_id).select('id');
  if (error) throw error;
  if (!data || data.length === 0) {
    throw new Error('This document is not yours to delete');
  }

  const path = (row.storage_path || '').trim();
  if (path && path !== 'pending' && row.storage_bucket) {
    const { error: storageError } = await supabase.storage.from(row.storage_bucket).remove([path]);
    if (storageError) console.warn('documentIndex storage remove:', storageError);
  }
}
