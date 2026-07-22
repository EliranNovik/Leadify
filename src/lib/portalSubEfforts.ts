import { compareSubEffortDisplayOrder } from './leadSubEfforts';

export type PortalSubEffortFolder = {
  id: string;
  title: string;
  note?: string | null;
  sort_order?: number;
  created_at?: string;
  created_by?: string | null;
  lead_sub_effort_id: number;
};

export type PortalSubEffortSubCategory = {
  id: number;
  name: string;
  description?: string | null;
  sort_order: number;
};

export type PortalSubEffortRow = {
  id: number;
  sub_effort_id: number;
  sub_effort_name: string;
  sub_effort_description?: string | null;
  active?: boolean;
  client_notes?: string | null;
  document_url?: unknown;
  sort_order?: number;
  template_sort_order?: number;
  created_at?: string;
  updated_at?: string;
  updated_by?: string | null;
  updated_by_photo_url?: string | null;
  sub_category_efforts?: PortalSubEffortSubCategory[];
};

export function normalizePortalSubCategoryEfforts(raw: unknown): PortalSubEffortSubCategory[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((item) => {
      if (!item || typeof item !== 'object') return null;
      const row = item as Record<string, unknown>;
      const id = Number(row.id);
      const name = typeof row.name === 'string' ? row.name.trim() : '';
      if (!Number.isFinite(id) || id <= 0 || !name) return null;
      return {
        id,
        name,
        description:
          typeof row.description === 'string' && row.description.trim()
            ? row.description.trim()
            : null,
        sort_order: Number.isFinite(Number(row.sort_order)) ? Number(row.sort_order) : 0,
      } satisfies PortalSubEffortSubCategory;
    })
    .filter(Boolean)
    .sort(
      (a, b) =>
        (a as PortalSubEffortSubCategory).sort_order - (b as PortalSubEffortSubCategory).sort_order ||
        (a as PortalSubEffortSubCategory).name.localeCompare(
          (b as PortalSubEffortSubCategory).name,
          undefined,
          { sensitivity: 'base' },
        ),
    ) as PortalSubEffortSubCategory[];
}

export function normalizePortalSubEffortFolders(
  raw: unknown,
): PortalSubEffortFolder[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((item) => {
      if (!item || typeof item !== 'object') return null;
      const row = item as Record<string, unknown>;
      const id = typeof row.id === 'string' ? row.id.trim() : String(row.id ?? '').trim();
      const title = typeof row.title === 'string' ? row.title.trim() : '';
      const leadSubEffortId = Number(row.lead_sub_effort_id);
      if (!id || !title || !Number.isFinite(leadSubEffortId)) return null;
      return {
        id,
        title,
        note: typeof row.note === 'string' ? row.note : null,
        sort_order: Number.isFinite(Number(row.sort_order)) ? Number(row.sort_order) : 0,
        created_at: typeof row.created_at === 'string' ? row.created_at : undefined,
        created_by: typeof row.created_by === 'string' ? row.created_by : null,
        lead_sub_effort_id: leadSubEffortId,
      } satisfies PortalSubEffortFolder;
    })
    .filter(Boolean) as PortalSubEffortFolder[];
}

export type PortalSubEffortProgress = 'completed' | 'in_progress' | 'pending';

/**
 * Active / current stage — same rule as SubEffortsLogModal:
 * first row in display order where `active !== false`.
 * Rows must already be sorted via `compareSubEffortDisplayOrder`.
 */
export function findCurrentPortalSubEffort(
  rows: PortalSubEffortRow[],
): PortalSubEffortRow | null {
  const current = rows.find((row) => row.active !== false);
  return current ?? null;
}

export function findCurrentPortalSubEffortId(rows: PortalSubEffortRow[]): number | null {
  return findCurrentPortalSubEffort(rows)?.id ?? null;
}

export function getPortalSubEffortProgress(
  row: PortalSubEffortRow,
  currentId: number | null,
): PortalSubEffortProgress {
  if (row.active === false) return 'completed';
  if (currentId != null && row.id === currentId) return 'in_progress';
  return 'pending';
}

/** Label for dashboard Case Status card (synced with CRM modal / portal workflow). */
export function portalActiveSubEffortCardCopy(rows: PortalSubEffortRow[]): {
  value: string;
  hint: string;
  current: PortalSubEffortRow | null;
} {
  const current = findCurrentPortalSubEffort(rows);
  if (current?.sub_effort_name?.trim()) {
    return {
      value: current.sub_effort_name.trim(),
      hint: 'Current stage in your workflow',
      current,
    };
  }
  if (rows.length > 0 && rows.every((row) => row.active === false)) {
    const last = rows[rows.length - 1];
    return {
      value: last.sub_effort_name?.trim() || 'Complete',
      hint: 'All stages complete',
      current: null,
    };
  }
  return {
    value: 'No active stage',
    hint: 'Latest case milestone',
    current: null,
  };
}

function portalRowTemplateId(row: Record<string, unknown>): number | null {
  const id = Number(row.sub_effort_id);
  return Number.isFinite(id) && id > 0 ? id : null;
}

function portalRowScore(row: Record<string, unknown>): number {
  let score = 0;
  if (row.active === false) score += 200;
  else if (row.active !== false) score += 100;
  if (row.document_url) score += 50;
  if (row.client_notes) score += 25;
  const updatedAt = typeof row.updated_at === 'string' ? new Date(row.updated_at).getTime() : 0;
  if (Number.isFinite(updatedAt)) score += Math.min(updatedAt / 1e15, 1);
  return score;
}

export function dedupePortalSubEffortRows(rows: Array<Record<string, unknown>>): PortalSubEffortRow[] {
  const byTemplateId = new Map<number, Record<string, unknown>>();

  for (const row of rows ?? []) {
    const templateId = portalRowTemplateId(row);
    if (templateId == null) continue;

    const existing = byTemplateId.get(templateId);
    if (!existing) {
      byTemplateId.set(templateId, row);
      continue;
    }

    const nextScore = portalRowScore(row);
    const prevScore = portalRowScore(existing);
    if (nextScore > prevScore) {
      byTemplateId.set(templateId, row);
      continue;
    }
    if (nextScore === prevScore && Number(row.id) < Number(existing.id)) {
      byTemplateId.set(templateId, row);
    }
  }

  return [...byTemplateId.values()]
    .map((row) => ({
      id: Number(row.id),
      sub_effort_id: Number(row.sub_effort_id),
      sub_effort_name: String(row.sub_effort_name ?? ''),
      sub_effort_description:
        typeof row.sub_effort_description === 'string' && row.sub_effort_description.trim()
          ? row.sub_effort_description.trim()
          : null,
      active: row.active === false ? false : true,
      client_notes: typeof row.client_notes === 'string' ? row.client_notes : null,
      document_url: row.document_url,
      sort_order: Number.isFinite(Number(row.sort_order)) ? Number(row.sort_order) : undefined,
      template_sort_order: Number.isFinite(Number(row.template_sort_order))
        ? Number(row.template_sort_order)
        : undefined,
      created_at: typeof row.created_at === 'string' ? row.created_at : undefined,
      updated_at: typeof row.updated_at === 'string' ? row.updated_at : undefined,
      updated_by:
        typeof row.updated_by === 'string' && row.updated_by.trim() ? row.updated_by.trim() : null,
      updated_by_photo_url:
        typeof row.updated_by_photo_url === 'string' && row.updated_by_photo_url.trim()
          ? row.updated_by_photo_url.trim()
          : null,
      sub_category_efforts: normalizePortalSubCategoryEfforts(row.sub_category_efforts),
    }))
    .sort(compareSubEffortDisplayOrder);
}
