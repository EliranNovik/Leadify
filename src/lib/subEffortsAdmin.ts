export type SubEffortDbRow = {
  id: number;
  name: string;
  description?: string | null;
  misc_category_id?: number | null;
  linked_misc_category_ids?: number[] | null;
  sort_order?: number | null;
  percentage?: number | string | null;
  active?: boolean | null;
  default_client_visible?: boolean | null;
  case_document_classification_id?: string | null;
  case_document_classification?:
    | { id: string; label: string }
    | { id: string; label: string }[]
    | null;
  created_at?: string | null;
  updated_at?: string | null;
};

export type SubEffortMiscCategoryLink = {
  id: number;
  sub_effort_id: number;
  misc_category_id: number;
};

export type SubCategoryEffortRow = {
  id: number;
  sub_effort_id: number;
  name: string;
  description: string | null;
  sort_order: number;
  percentage: number | string;
};

export type MiscCategoryOption = {
  id: number;
  name: string;
  parent_id: number | null;
  mainCategoryName: string | null;
};

export type SubEffortAdminItem = {
  id: number;
  name: string;
  description: string | null;
  sort_order: number;
  percentage: number;
  active: boolean;
  default_client_visible: boolean;
  case_document_classification_id: string | null;
  case_document_classification?: SubEffortDbRow['case_document_classification'];
  linkedCategoryIds: number[];
  updated_at?: string | null;
};

export const normalizeSubEffortName = (value: string) => value.trim().replace(/\s+/g, ' ');

export const subEffortNameKey = (value: string) => normalizeSubEffortName(value).toLowerCase();

export function caseDocCategoryLabel(row: {
  case_document_classification?: SubEffortDbRow['case_document_classification'];
}): string | null {
  const v = row.case_document_classification;
  if (!v) return null;
  if (Array.isArray(v)) return v[0]?.label?.trim() || null;
  return v.label?.trim() || null;
}

export function miscCategoryDisplayLabel(cat: MiscCategoryOption): string {
  const main = cat.mainCategoryName?.trim();
  return main ? `${cat.name} (${main})` : cat.name;
}

export function normalizeMiscCategoryIds(
  ids: Array<number | string | null | undefined>,
): number[] {
  return [
    ...new Set(
      ids
        .map((id) => Number(id))
        .filter((id) => Number.isFinite(id) && id > 0),
    ),
  ].sort((a, b) => a - b);
}

function parseRpcIntegerArray(data: unknown): number[] | null {
  if (data == null) return null;
  if (Array.isArray(data)) return normalizeMiscCategoryIds(data);
  if (typeof data === 'number' && Number.isFinite(data)) {
    // Legacy RPC returned a count — treat as unknown ids so caller refetches.
    return null;
  }
  if (typeof data === 'string') {
    const trimmed = data.replace(/[{}]/g, '').trim();
    if (!trimmed) return [];
    return normalizeMiscCategoryIds(trimmed.split(','));
  }
  return null;
}

function arraysEqual(a: number[], b: number[]): boolean {
  if (a.length !== b.length) return false;
  return a.every((value, index) => value === b[index]);
}

export function buildSubEffortAdminItems(
  rows: SubEffortDbRow[],
  links: SubEffortMiscCategoryLink[],
): SubEffortAdminItem[] {
  const linksBySubEffort = new Map<number, Set<number>>();
  for (const link of links) {
    const bucket = linksBySubEffort.get(Number(link.sub_effort_id)) ?? new Set<number>();
    bucket.add(Number(link.misc_category_id));
    linksBySubEffort.set(Number(link.sub_effort_id), bucket);
  }

  return rows
    .map((row) => {
      const linked = linksBySubEffort.get(Number(row.id)) ?? new Set<number>();
      if (row.misc_category_id != null) linked.add(Number(row.misc_category_id));
      if (Array.isArray(row.linked_misc_category_ids)) {
        for (const id of normalizeMiscCategoryIds(row.linked_misc_category_ids)) {
          linked.add(id);
        }
      }

      return {
        id: Number(row.id),
        name: row.name,
        description: row.description?.trim() ? String(row.description).trim() : null,
        sort_order: Number(row.sort_order ?? 0),
        percentage: Number(row.percentage ?? 0),
        active: (row.active ?? true) === true,
        default_client_visible: row.default_client_visible !== false,
        case_document_classification_id: row.case_document_classification_id ?? null,
        case_document_classification: row.case_document_classification,
        linkedCategoryIds: normalizeMiscCategoryIds([...linked]),
        updated_at: row.updated_at ?? null,
      };
    })
    .sort(
      (a, b) =>
        a.sort_order - b.sort_order ||
        a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }),
    );
}

export function subEffortPayload(group: {
  name: string;
  description: string | null;
  sort_order: number;
  percentage: number;
  active: boolean;
  default_client_visible: boolean;
  case_document_classification_id: string | null;
}) {
  return {
    name: normalizeSubEffortName(group.name),
    description: group.description?.trim() ? group.description.trim() : null,
    sort_order: group.sort_order,
    percentage: group.percentage,
    active: group.active,
    default_client_visible: group.default_client_visible,
    case_document_classification_id: group.case_document_classification_id,
  };
}

const SUPABASE_PAGE_SIZE = 1000;

/** PostgREST caps at 1000 rows per request — page until all rows are loaded. */
export async function fetchAllSupabaseRows<T>(
  fetchPage: (from: number, to: number) => Promise<{ data: T[] | null; error: { message: string } | null }>,
): Promise<T[]> {
  const all: T[] = [];
  let from = 0;

  while (true) {
    const { data, error } = await fetchPage(from, from + SUPABASE_PAGE_SIZE - 1);
    if (error) throw error;
    const batch = data ?? [];
    all.push(...batch);
    if (batch.length < SUPABASE_PAGE_SIZE) break;
    from += SUPABASE_PAGE_SIZE;
  }

  return all;
}

export async function fetchSubEffortsForAdmin(
  supabase: {
    rpc: (
      fn: string,
      args?: Record<string, never>,
    ) => Promise<{ data: unknown; error: { message: string } | null }>;
    from: (table: string) => any;
  },
): Promise<SubEffortDbRow[]> {
  const rpcRes = await supabase.rpc('admin_list_sub_efforts');
  if (!rpcRes.error && Array.isArray(rpcRes.data)) {
    return (rpcRes.data as Record<string, unknown>[]).map((row) => row as unknown as SubEffortDbRow);
  }

  if (rpcRes.error) {
    console.warn('admin_list_sub_efforts RPC unavailable, falling back to table select:', rpcRes.error.message);
  }

  return fetchAllSupabaseRows<SubEffortDbRow>(async (from, to) => {
    const res = await supabase
      .from('sub_efforts')
      .select(
        'id, name, description, sort_order, percentage, active, case_document_classification_id, created_at, updated_at',
      )
      .order('sort_order', { ascending: true })
      .order('id', { ascending: true })
      .range(from, to);
    return { data: (res.data ?? []) as SubEffortDbRow[], error: res.error };
  });
}

export async function fetchSubEffortMiscCategoryLinksForAdmin(
  supabase: {
    rpc: (
      fn: string,
      args?: Record<string, never>,
    ) => Promise<{ data: unknown; error: { message: string } | null }>;
    from: (table: string) => any;
  },
): Promise<SubEffortMiscCategoryLink[]> {
  // Always paginate — PostgREST caps single responses at 1000 rows; junction tables can be much larger.
  const res = await fetchAllSupabaseRows<SubEffortMiscCategoryLink>(async (from, to) => {
    const page = await supabase
      .from('sub_effort_misc_categories')
      .select('id, sub_effort_id, misc_category_id')
      .order('sub_effort_id', { ascending: true })
      .order('misc_category_id', { ascending: true })
      .range(from, to);
    return { data: (page.data ?? []) as SubEffortMiscCategoryLink[], error: page.error };
  });

  if (res.length > 0) return res;

  const rpcRes = await supabase.rpc('admin_list_sub_effort_misc_category_links');
  if (!rpcRes.error && Array.isArray(rpcRes.data) && rpcRes.data.length > 0) {
    console.warn(
      'sub_effort_misc_categories table returned no rows; using admin_list_sub_effort_misc_category_links RPC (may be capped at 1000).',
    );
    return rpcRes.data as SubEffortMiscCategoryLink[];
  }

  if (rpcRes.error) {
    const tableProbe = await supabase.from('sub_effort_misc_categories').select('id').limit(1);
    if (tableProbe.error) {
      throw new Error(
        tableProbe.error.message ||
          'Case type link table missing. Run sql/2026-07-09_sub_effort_misc_categories_junction.sql in Supabase.',
      );
    }
  }

  return res;
}

export async function fetchMiscCategoryIdsForSubEffort(
  supabase: {
    rpc: (
      fn: string,
      args?: Record<string, unknown>,
    ) => Promise<{ data: unknown; error: { message: string; code?: string } | null }>;
    from: (table: string) => any;
  },
  subEffortId: number,
): Promise<number[]> {
  const effortId = Number(subEffortId);
  const rpcRes = await supabase.rpc('admin_get_sub_effort_misc_category_ids', {
    p_sub_effort_id: effortId,
  });
  const fromRpc = parseRpcIntegerArray(rpcRes.data);
  if (!rpcRes.error && fromRpc != null) return fromRpc;

  const { data, error } = await supabase
    .from('sub_effort_misc_categories')
    .select('misc_category_id')
    .eq('sub_effort_id', effortId);
  if (error) {
    throw new Error(
      rpcRes.error?.message ||
        error.message ||
        'Could not load case type links. Run sql/2026-07-09_sub_effort_misc_categories_junction.sql and sql/2026-07-09_admin_list_sub_efforts.sql.',
    );
  }
  return normalizeMiscCategoryIds(
    ((data ?? []) as { misc_category_id: number }[]).map((row) => row.misc_category_id),
  );
}

export async function syncSubEffortMiscCategoryLinksForAdmin(
  supabase: {
    rpc: (
      fn: string,
      args?: Record<string, unknown>,
    ) => Promise<{ data: unknown; error: { message: string; code?: string } | null }>;
    from: (table: string) => any;
  },
  subEffortId: number,
  categoryIds: Array<number | string | null | undefined>,
): Promise<number[]> {
  const expected = normalizeMiscCategoryIds(categoryIds);
  const effortId = Number(subEffortId);

  const rpcRes = await supabase.rpc('admin_sync_sub_effort_misc_categories', {
    p_sub_effort_id: effortId,
    p_misc_category_ids: expected,
  });

  let saved = parseRpcIntegerArray(rpcRes.data);
  if (!rpcRes.error && saved != null) {
    if (!arraysEqual(saved, expected)) {
      throw new Error(
        `Case type links mismatch after save (expected ${expected.length}, got ${saved.length}).`,
      );
    }
    return saved;
  }

  const rpcMessage = rpcRes.error?.message;
  if (rpcMessage) {
    console.warn('admin_sync_sub_effort_misc_categories RPC failed, using table fallback:', rpcMessage);
  }

  const { error: deleteError } = await supabase
    .from('sub_effort_misc_categories')
    .delete()
    .eq('sub_effort_id', effortId);
  if (deleteError) {
    throw new Error(
      deleteError.message ||
        'Failed to clear case type links. Ensure sub_effort_misc_categories exists with RLS policies.',
    );
  }

  if (expected.length > 0) {
    const { error: insertError } = await supabase.from('sub_effort_misc_categories').insert(
      expected.map((misc_category_id) => ({
        sub_effort_id: effortId,
        misc_category_id,
      })),
    );
    if (insertError) {
      throw new Error(insertError.message || 'Failed to save case type links.');
    }
  }

  saved = await fetchMiscCategoryIdsForSubEffort(supabase, effortId);
  if (!arraysEqual(saved, expected)) {
    throw new Error(
      `Case type links were not saved correctly (expected ${expected.length}, got ${saved.length}).`,
    );
  }
  return saved;
}
