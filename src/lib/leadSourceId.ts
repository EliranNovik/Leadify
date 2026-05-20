import { supabase } from './supabase';

export type LeadSourceOption = {
  id: string;
  name: string;
  code: string;
};

/** Convert API/DB id to string without Number() precision loss. */
export function leadSourceIdToString(id: unknown): string | null {
  if (id == null || id === '' || id === '---') return null;
  if (typeof id === 'bigint') return id.toString();
  if (typeof id === 'string') {
    const s = id.trim();
    if (s === '' || s === 'null' || s === 'undefined') return null;
    return s;
  }
  if (typeof id === 'number') {
    if (!Number.isFinite(id)) return null;
    return String(Math.trunc(id));
  }
  const s = String(id).trim();
  return s === '' || s === 'null' || s === 'undefined' ? null : s;
}

export function normalizeLeadSourceId(sourceId: unknown): string | null {
  return leadSourceIdToString(sourceId);
}

/** Value safe for PostgREST filters/updates on bigint columns — always string. */
export function leadSourceIdForDb(id: string | null | undefined): string | null {
  return normalizeLeadSourceId(id);
}

export function normalizeLeadSourceCode(source: {
  id: unknown;
  code: unknown;
}): string | null {
  const codeStr = source.code != null ? leadSourceIdToString(source.code) : null;
  if (codeStr) return codeStr;
  return leadSourceIdToString(source.id);
}

export function getSourceDisplayFromJoin(lead: {
  misc_leadsource?: unknown;
} | null | undefined): string | null {
  const src = lead?.misc_leadsource;
  if (!src) return null;
  const record = Array.isArray(src) ? src[0] : src;
  const name = (record as { name?: string })?.name;
  if (!name || typeof name !== 'string') return null;
  const trimmed = name.trim();
  return trimmed || null;
}

function mapRowsToOptions(rows: Array<{ id: string; name: string; code?: string | null }>): LeadSourceOption[] {
  const options: LeadSourceOption[] = [];
  for (const row of rows) {
    if (!row?.name) continue;
    const id = leadSourceIdToString(row.id);
    if (!id) continue;
    const code = row.code != null && String(row.code).trim() !== '' ? String(row.code).trim() : id;
    options.push({ id, name: String(row.name), code });
  }
  return options;
}

/** Active sources — same fetch pattern as CreateNewLead (id/code kept as strings in JS). */
export async function fetchActiveLeadSourceOptions(): Promise<LeadSourceOption[]> {
  const { data, error } = await supabase
    .from('misc_leadsource')
    .select('id, name, code')
    .eq('active', true)
    .order('order', { ascending: true, nullsFirst: false })
    .order('name', { ascending: true });

  if (error) {
    console.error('[fetchActiveLeadSourceOptions]', error);
    return [];
  }

  return mapRowsToOptions(data || []);
}

export function lookupSourceNameById(
  sourceId: string,
  sources: Array<{ id: string; name: string }>,
): string | null {
  const id = normalizeLeadSourceId(sourceId);
  if (!id) return null;
  return sources.find((s) => s.id === id)?.name ?? null;
}

/** Write source_id (+ optional denormalized source name) using string ids for bigint columns. */
export function applyLeadSourceIdUpdate(
  updateData: Record<string, unknown>,
  nextSourceId: string | null,
  displayName?: string | null,
): void {
  const idForDb = leadSourceIdForDb(nextSourceId);
  if (idForDb) {
    updateData.source_id = idForDb;
    const name = displayName?.trim();
    if (name) updateData.source = name;
  } else {
    updateData.source_id = null;
  }
}

/** Match typed/selected source text to option (name, id, or code) — same tokens as CreateNewLead. */
export function resolveSourceFromInputValue(
  value: string,
  options: LeadSourceOption[],
): { source: string; source_id: string | null } {
  const trimmed = value.trim();
  if (!trimmed) return { source: value, source_id: null };

  const byName = options.find((o) => o.name.toLowerCase() === trimmed.toLowerCase());
  if (byName) return { source: byName.name, source_id: byName.id };

  const byToken = options.find((o) => o.id === trimmed || o.code === trimmed);
  if (byToken) return { source: byToken.name, source_id: byToken.id };

  return { source: value, source_id: null };
}

async function lookupMiscLeadsourceByToken(
  token: string,
): Promise<{ id: string; name: string } | null> {
  const t = token.trim();
  if (!t) return null;

  const { data: byId, error: byIdErr } = await supabase
    .from('misc_leadsource')
    .select('id, name')
    .eq('id', t)
    .eq('active', true)
    .maybeSingle();
  if (!byIdErr && byId?.id != null) {
    const id = leadSourceIdToString(byId.id);
    if (id) return { id, name: String(byId.name ?? '') };
  }

  const { data: byName, error: byNameErr } = await supabase
    .from('misc_leadsource')
    .select('id, name')
    .eq('name', t)
    .eq('active', true)
    .maybeSingle();
  if (!byNameErr && byName?.id != null) {
    const id = leadSourceIdToString(byName.id);
    if (id) return { id, name: String(byName.name ?? '') };
  }

  return null;
}

/**
 * Resolve misc_leadsource.id for edit save (aligned with CreateNewLead p_source_code lookup).
 */
export async function resolveSourceIdForEditSave(params: {
  sourceDisplay: string;
  sourceIdInForm: string | null;
  options: LeadSourceOption[];
}): Promise<{ id: string; name: string } | null> {
  const trimmed = params.sourceDisplay.trim();
  const formId = normalizeLeadSourceId(params.sourceIdInForm);

  if (formId) {
    const opt = params.options.find((o) => o.id === formId);
    if (opt) return { id: opt.id, name: opt.name };
    const fromDb = await lookupMiscLeadsourceByToken(formId);
    if (fromDb) return fromDb;
  }

  if (!trimmed) return null;

  const fromInput = resolveSourceFromInputValue(trimmed, params.options);
  if (fromInput.source_id) {
    const opt = params.options.find((o) => o.id === fromInput.source_id);
    return { id: fromInput.source_id, name: opt?.name ?? fromInput.source };
  }

  return lookupMiscLeadsourceByToken(trimmed);
}
