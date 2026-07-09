import type { SupabaseClient } from '@supabase/supabase-js';

export type LeadSubEffortCatalogItem = {
  id: number;
  name: string;
  sort_order: number;
  default_client_visible: boolean;
};

export function defaultClientVisibleFromTemplate(value: boolean | null | undefined): boolean {
  return value !== false;
}

export function leadSubEffortInternalFromTemplate(defaultClientVisible: boolean | null | undefined): boolean {
  return !defaultClientVisibleFromTemplate(defaultClientVisible);
}

export function resolveLeadMiscCategoryId(
  client:
    | {
        category_id?: unknown;
        misc_category?: { id?: unknown } | Array<{ id?: unknown }> | null;
      }
    | null
    | undefined,
): number | null {
  const raw = client?.category_id;
  const n = Number(raw);
  if (Number.isFinite(n) && n > 0) return n;

  const mc = Array.isArray(client?.misc_category) ? client.misc_category[0] : client?.misc_category;
  const fromJoin = Number(mc?.id);
  return Number.isFinite(fromJoin) && fromJoin > 0 ? fromJoin : null;
}

export function leadSubEffortIdentityFromClientId(clientId: string | null | undefined): {
  legacyLeadId: number | null;
  newLeadId: string | null;
} {
  const idStr = String(clientId ?? '').trim();
  if (!idStr) return { legacyLeadId: null, newLeadId: null };
  if (idStr.startsWith('legacy_')) {
    const legacyId = Number.parseInt(idStr.replace('legacy_', ''), 10);
    return { legacyLeadId: Number.isFinite(legacyId) ? legacyId : null, newLeadId: null };
  }
  return { legacyLeadId: null, newLeadId: idStr };
}

/** Resolve lead_sub_efforts owner from CRM client id and/or displayed lead number (incl. legacy). */
export async function resolveLeadSubEffortIdentityFromRefs(
  supabase: SupabaseClient,
  params: { clientId?: string | null; leadNumber?: string | null },
): Promise<{ legacyLeadId: number | null; newLeadId: string | null }> {
  const fromClientId = leadSubEffortIdentityFromClientId(params.clientId);
  if (fromClientId.legacyLeadId || fromClientId.newLeadId) return fromClientId;

  const leadNum = String(params.leadNumber ?? '').trim();
  if (!leadNum) return { legacyLeadId: null, newLeadId: null };

  const { data: newRow } = await supabase
    .from('leads')
    .select('id')
    .eq('lead_number', leadNum)
    .maybeSingle();
  const newId = (newRow as { id?: string } | null)?.id;
  if (typeof newId === 'string' && newId.trim()) {
    return { legacyLeadId: null, newLeadId: newId.trim() };
  }

  const legacySub = leadNum.match(/^(\d+)\/(\d+)$/);
  if (legacySub) {
    const masterId = Number.parseInt(legacySub[1], 10);
    const suffix = Number.parseInt(legacySub[2], 10);
    if (Number.isFinite(masterId) && Number.isFinite(suffix) && suffix >= 2) {
      const { data: subRows } = await supabase
        .from('leads_lead')
        .select('id')
        .eq('master_id', masterId)
        .order('id', { ascending: true });
      const row = (subRows ?? [])[suffix - 2] as { id?: number } | undefined;
      if (row?.id != null) return { legacyLeadId: Number(row.id), newLeadId: null };
    }
  }

  if (/^\d+$/.test(leadNum)) {
    const legacyId = Number.parseInt(leadNum, 10);
    const { data: legacyRow } = await supabase
      .from('leads_lead')
      .select('id')
      .eq('id', legacyId)
      .maybeSingle();
    if ((legacyRow as { id?: number } | null)?.id != null) {
      return { legacyLeadId: legacyId, newLeadId: null };
    }
  }

  return { legacyLeadId: null, newLeadId: null };
}

/** True when a user explicitly saved changes on this lead_sub_efforts row (not auto-provision). */
export function hasLeadSubEffortSavedUpdate(row: {
  updated_by?: unknown;
  created_by?: unknown;
  created_at?: unknown;
  updated_at?: unknown;
} | null | undefined): boolean {
  const updatedBy = String(row?.updated_by ?? '').trim();
  if (!updatedBy) return false;

  const createdMs = row?.created_at ? new Date(row.created_at).getTime() : NaN;
  const updatedMs = row?.updated_at ? new Date(row.updated_at).getTime() : NaN;
  if (Number.isFinite(createdMs) && Number.isFinite(updatedMs) && updatedMs - createdMs > 1000) {
    return true;
  }

  const createdBy = String(row?.created_by ?? '').trim();
  return !!(createdBy && updatedBy !== createdBy);
}

export function leadSubEffortSavedUpdatedBy(row: {
  updated_by?: unknown;
  created_by?: unknown;
  created_at?: unknown;
  updated_at?: unknown;
} | null | undefined): string | null {
  if (!hasLeadSubEffortSavedUpdate(row)) return null;
  return String(row?.updated_by ?? '').trim() || null;
}

export function leadSubEffortSavedUpdatedAt(row: {
  updated_by?: unknown;
  created_by?: unknown;
  created_at?: unknown;
  updated_at?: unknown;
} | null | undefined): string | null {
  if (!hasLeadSubEffortSavedUpdate(row)) return null;
  const at = row?.updated_at;
  return at ? String(at) : null;
}

export function parseSubEffortFromLinkRow(row: {
  sub_efforts?: {
    id: unknown;
    name: unknown;
    sort_order?: unknown;
    active?: unknown;
    default_client_visible?: unknown;
  } | Array<{
    id: unknown;
    name: unknown;
    sort_order?: unknown;
    active?: unknown;
    default_client_visible?: unknown;
  }> | null;
}): LeadSubEffortCatalogItem | null {
  const se = Array.isArray(row.sub_efforts) ? row.sub_efforts[0] : row.sub_efforts;
  if (!se) return null;
  if (se.active === false) return null;
  const id = Number(se.id);
  if (!Number.isFinite(id) || id <= 0) return null;
  return {
    id,
    name: String(se.name ?? ''),
    sort_order: Number(se.sort_order ?? 0),
    default_client_visible: defaultClientVisibleFromTemplate(se.default_client_visible as boolean | null | undefined),
  };
}

/** Sub-effort templates linked to the lead's misc_category (case type). */
export async function fetchSubEffortsForMiscCategory(
  supabase: SupabaseClient,
  miscCategoryId: number | null | undefined,
): Promise<LeadSubEffortCatalogItem[]> {
  const catId = Number(miscCategoryId);
  if (!Number.isFinite(catId) || catId <= 0) return [];

  const { data, error } = await supabase
    .from('sub_effort_misc_categories')
    .select('misc_category_id, sub_efforts ( id, name, sort_order, active, default_client_visible )')
    .eq('misc_category_id', catId);

  if (error) {
    if (String(error.message || '').includes('sub_effort_misc_categories')) {
      console.warn('sub_effort_misc_categories unavailable; falling back to all active sub_efforts');
      const fallback = await supabase
        .from('sub_efforts')
        .select('id, name, sort_order, active, default_client_visible')
        .eq('active', true)
        .order('sort_order', { ascending: true })
        .order('name', { ascending: true });
      if (fallback.error) throw fallback.error;
      return ((fallback.data ?? []) as any[]).map((row) => ({
        id: Number(row.id),
        name: String(row.name ?? ''),
        sort_order: Number(row.sort_order ?? 0),
        default_client_visible: defaultClientVisibleFromTemplate(row.default_client_visible),
      }));
    }
    throw error;
  }

  const byId = new Map<number, LeadSubEffortCatalogItem>();
  for (const row of data ?? []) {
    const item = parseSubEffortFromLinkRow(row as any);
    if (item) byId.set(item.id, item);
  }

  return [...byId.values()].sort(
    (a, b) => a.sort_order - b.sort_order || a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }),
  );
}

export function leadSubEffortIdentity(client: { id?: unknown; lead_type?: string | null }) {
  const idStr = String(client.id ?? '');
  const isLegacy = idStr.startsWith('legacy_') || client.lead_type === 'legacy';
  const parsed = leadSubEffortIdentityFromClientId(idStr);
  if (isLegacy && parsed.legacyLeadId == null && /^\d+$/.test(idStr)) {
    const legacyId = Number.parseInt(idStr, 10);
    return { isLegacy: true, legacyId: Number.isFinite(legacyId) ? legacyId : null, newLeadId: null };
  }
  return { isLegacy, legacyId: parsed.legacyLeadId, newLeadId: parsed.newLeadId };
}

function readLeadSubEffortSortOrder(row: { sort_order?: unknown }): number {
  const n = Number(row?.sort_order);
  return Number.isFinite(n) ? n : Number.MAX_SAFE_INTEGER;
}

function readSubEffortTemplateSortOrder(row: {
  template_sort_order?: unknown;
  sub_efforts?:
    | { sort_order?: unknown }
    | Array<{ sort_order?: unknown }>
    | null;
}): number {
  if (row.template_sort_order != null) {
    const direct = Number(row.template_sort_order);
    if (Number.isFinite(direct)) return direct;
  }
  const se = Array.isArray(row.sub_efforts) ? row.sub_efforts[0] : row.sub_efforts;
  const n = Number(se?.sort_order);
  return Number.isFinite(n) ? n : Number.MAX_SAFE_INTEGER;
}

/** Per-lead timeline order first, then sub_efforts template order. */
export function compareSubEffortDisplayOrder(a: any, b: any): number {
  const leadDiff = readLeadSubEffortSortOrder(a) - readLeadSubEffortSortOrder(b);
  if (leadDiff !== 0) return leadDiff;

  const templateDiff = readSubEffortTemplateSortOrder(a) - readSubEffortTemplateSortOrder(b);
  if (templateDiff !== 0) return templateDiff;

  const createdA = a?.created_at ? new Date(a.created_at).getTime() : 0;
  const createdB = b?.created_at ? new Date(b.created_at).getTime() : 0;
  if (createdA !== createdB) return createdA - createdB;

  return Number(a?.id) - Number(b?.id);
}

export function leadSubEffortRowTemplateId(row: any): number | null {
  const id = Number(row?.sub_effort_id ?? row?.sub_efforts?.id);
  return Number.isFinite(id) && id > 0 ? id : null;
}

function leadSubEffortRowScore(row: any): number {
  let score = 0;
  if (row?.active !== false) score += 100;
  if (row?.document_url) score += 50;
  if (row?.internal_notes || row?.client_notes) score += 25;
  return score;
}

/** One timeline row per sub_effort template (keeps the richest / oldest row). */
export function dedupeLeadSubEffortRows(rows: any[]): any[] {
  const byTemplateId = new Map<number, any>();

  for (const row of rows ?? []) {
    const templateId = leadSubEffortRowTemplateId(row);
    if (templateId == null) continue;

    const existing = byTemplateId.get(templateId);
    if (!existing) {
      byTemplateId.set(templateId, row);
      continue;
    }

    const nextScore = leadSubEffortRowScore(row);
    const prevScore = leadSubEffortRowScore(existing);
    if (nextScore > prevScore) {
      byTemplateId.set(templateId, row);
      continue;
    }
    if (nextScore === prevScore && Number(row?.id) < Number(existing?.id)) {
      byTemplateId.set(templateId, row);
    }
  }

  return [...byTemplateId.values()].sort(compareSubEffortDisplayOrder);
}

export async function fetchExistingLeadSubEffortTemplateIds(
  supabase: SupabaseClient,
  params: { legacyLeadId: number | null; newLeadId: string | null },
): Promise<Set<number>> {
  const { legacyLeadId, newLeadId } = params;
  if (!legacyLeadId && !newLeadId) return new Set();

  let q = supabase.from('lead_sub_efforts').select('sub_effort_id');
  if (legacyLeadId) q = q.eq('legacy_lead_id', legacyLeadId);
  else if (newLeadId) q = q.eq('new_lead_id', newLeadId);

  const { data, error } = await q;
  if (error) throw error;

  return new Set(
    (data ?? [])
      .map((row) => Number((row as { sub_effort_id?: unknown }).sub_effort_id))
      .filter((n) => Number.isFinite(n) && n > 0),
  );
}

/** Create missing lead_sub_efforts rows for every template linked to the lead case type. */
export async function ensureLeadSubEffortRows(
  supabase: SupabaseClient,
  params: {
    catalog: LeadSubEffortCatalogItem[];
    legacyLeadId: number | null;
    newLeadId: string | null;
    actor: { employeeId?: number | null; fullName?: string | null };
  },
): Promise<boolean> {
  const { catalog, legacyLeadId, newLeadId, actor } = params;
  if (!catalog.length) return false;
  if (!legacyLeadId && !newLeadId) return false;

  const catalogById = new Map<number, LeadSubEffortCatalogItem>();
  for (const item of catalog) catalogById.set(item.id, item);

  const existingIds = await fetchExistingLeadSubEffortTemplateIds(supabase, { legacyLeadId, newLeadId });
  const missing = [...catalogById.values()].filter((item) => !existingIds.has(item.id));
  if (!missing.length) return false;

  const payloads = missing.map((item) => {
    const row: Record<string, unknown> = {
      sub_effort_id: item.id,
      sort_order: item.sort_order,
      employee_id: actor.employeeId ?? null,
      created_by: actor.fullName ?? null,
      internal: leadSubEffortInternalFromTemplate(item.default_client_visible),
      active: true,
    };
    if (legacyLeadId) row.legacy_lead_id = legacyLeadId;
    if (newLeadId) row.new_lead_id = newLeadId;
    return row;
  });

  const { error } = await supabase.from('lead_sub_efforts').insert(payloads);
  if (error) {
    if (error.code === '23505') return false;
    throw error;
  }
  return true;
}
