import { fetchStageActorInfo } from './leadStageManager';
import { supabase } from './supabase';

export type SubEffortDocItem = {
  url?: string;
  path?: string;
  name?: string;
  mimeType?: string;
  folder_id?: string | null;
};

export type SubEffortAttachmentRef = {
  id: string;
  name: string;
};

export function normalizeStorageKey(value: string | null | undefined): string {
  return String(value ?? '')
    .trim()
    .replace(/^\/+/, '');
}

export function normalizeSubEffortDocItems(documentUrl: unknown): SubEffortDocItem[] {
  if (!documentUrl) return [];
  if (typeof documentUrl === 'string') {
    const s = documentUrl.trim();
    if (!s) return [];
    if (/^https?:\/\//i.test(s)) return [{ url: s }];
    return [{ path: s }];
  }
  if (Array.isArray(documentUrl)) {
    const out: SubEffortDocItem[] = [];
    for (const u of documentUrl) out.push(...normalizeSubEffortDocItems(u));
    return out;
  }
  if (typeof documentUrl === 'object') {
    const o = documentUrl as Record<string, unknown>;
    if (typeof o.path === 'string' || typeof o.url === 'string') {
      return [
        {
          path: typeof o.path === 'string' ? o.path : undefined,
          url: typeof o.url === 'string' ? o.url : undefined,
          name: typeof o.name === 'string' ? o.name : undefined,
          mimeType: typeof o.mimeType === 'string' ? o.mimeType : undefined,
          folder_id:
            typeof o.folder_id === 'string'
              ? o.folder_id
              : o.folder_id === null
                ? null
                : undefined,
        },
      ];
    }
    for (const key of ['urls', 'files', 'documents', 'items'] as const) {
      if (Array.isArray(o[key])) return normalizeSubEffortDocItems(o[key]);
    }
  }
  return [];
}

/** Map storage path → sub efforts that already reference this file. */
export function buildSubEffortAttachmentsByPath(
  rows: Array<{ id?: unknown; document_url?: unknown; sub_efforts?: unknown }> | null | undefined,
): Map<string, SubEffortAttachmentRef[]> {
  const map = new Map<string, SubEffortAttachmentRef[]>();
  for (const row of rows ?? []) {
    const id = row?.id != null ? String(row.id) : '';
    if (!id) continue;
    const se = Array.isArray(row?.sub_efforts) ? row.sub_efforts[0] : row?.sub_efforts;
    const name =
      typeof (se as { name?: unknown } | null | undefined)?.name === 'string'
        ? String((se as { name: string }).name).trim()
        : '';
    const label = name || `Sub effort #${id}`;
    const items = normalizeSubEffortDocItems(row?.document_url);
    for (const item of items) {
      const path = normalizeStorageKey(item.path);
      if (!path) continue;
      const list = map.get(path) ?? [];
      if (!list.some((x) => x.id === id)) list.push({ id, name: label });
      map.set(path, list);
    }
  }
  return map;
}

export async function attachStoragePathsToSubEffort(params: {
  targetSubEffortId: string | number;
  targetDocumentUrl: unknown;
  activeFolderId?: string | null;
  items: Array<{ path: string; name?: string | null; mimeType?: string | null }>;
}): Promise<{ addedCount: number }> {
  const existingItems = normalizeSubEffortDocItems(params.targetDocumentUrl);
  const existingKeySet = new Set(
    existingItems.map((d) => (d.path || d.url || '').trim()).filter(Boolean),
  );

  const addedItems: SubEffortDocItem[] = params.items
    .map((d) => {
      const item: SubEffortDocItem = {
        path: d.path.trim(),
        name: d.name?.trim() || undefined,
        mimeType: d.mimeType?.trim() || undefined,
      };
      if (params.activeFolderId) item.folder_id = params.activeFolderId;
      return item;
    })
    .filter((d) => d.path && !existingKeySet.has(String(d.path)));

  if (addedItems.length === 0) {
    return { addedCount: 0 };
  }

  const merged = [...existingItems, ...addedItems];
  const actor = await fetchStageActorInfo();
  const { error } = await supabase
    .from('lead_sub_efforts')
    .update({ document_url: merged, updated_by: actor.fullName })
    .eq('id', params.targetSubEffortId);
  if (error) throw error;

  return { addedCount: addedItems.length };
}

export type SubEffortAttachOption = {
  id: string;
  name: string;
  documentUrl: unknown;
};

export function listSubEffortAttachOptions(
  rows: Array<{ id?: unknown; document_url?: unknown; sub_efforts?: unknown }> | null | undefined,
): SubEffortAttachOption[] {
  const out: SubEffortAttachOption[] = [];
  for (const row of rows ?? []) {
    const id = row?.id != null ? String(row.id) : '';
    if (!id) continue;
    const se = Array.isArray(row?.sub_efforts) ? row.sub_efforts[0] : row?.sub_efforts;
    const name =
      typeof (se as { name?: unknown } | null | undefined)?.name === 'string'
        ? String((se as { name: string }).name).trim()
        : '';
    out.push({
      id,
      name: name || `Sub effort #${id}`,
      documentUrl: row?.document_url ?? null,
    });
  }
  return out;
}
