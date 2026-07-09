import { compareSubEffortDisplayOrder } from './leadSubEfforts';

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
};

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
      updated_by: typeof row.updated_by === 'string' ? row.updated_by : null,
    }))
    .sort(compareSubEffortDisplayOrder);
}
