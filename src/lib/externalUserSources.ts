import { supabase } from './supabase';
import { leadSourceIdToString } from './leadSourceId';

/**
 * Parse `users.extern_source_id` (JSONB array or JSON string) as string ids.
 * Avoids Number() so bigint misc_leadsource ids stay exact.
 */
export function parseExternSourceIdStrings(raw: unknown): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  const push = (v: unknown) => {
    const s = leadSourceIdToString(v);
    if (!s || seen.has(s)) return;
    seen.add(s);
    out.push(s);
  };
  if (Array.isArray(raw)) {
    raw.forEach(push);
  } else if (typeof raw === 'string') {
    const trimmed = raw.trim();
    if (!trimmed) return out;
    try {
      const p = JSON.parse(trimmed);
      if (Array.isArray(p)) p.forEach(push);
      else push(p);
    } catch {
      push(trimmed);
    }
  }
  return out;
}

/** misc_leadsource ids assigned to the logged-in external user (`users.extern_source_id`). */
export async function fetchCurrentUserExternSourceIds(): Promise<string[]> {
  const {
    data: { user: authUser },
    error: authError,
  } = await supabase.auth.getUser();
  if (authError || !authUser) {
    return [];
  }

  let row: { extern_source_id?: unknown } | null = null;

  const { data: byAuth, error: authLookupError } = await supabase
    .from('users')
    .select('extern_source_id')
    .eq('auth_id', authUser.id)
    .maybeSingle();

  if (authLookupError) {
    throw authLookupError;
  }
  row = byAuth;

  // Same fallback as ExternalUserLeadSearch / dashboard when auth_id is missing or stale.
  if (!row && authUser.email) {
    const { data: byEmail, error: emailLookupError } = await supabase
      .from('users')
      .select('extern_source_id')
      .eq('email', authUser.email)
      .maybeSingle();
    if (emailLookupError) {
      throw emailLookupError;
    }
    row = byEmail;
  }

  return parseExternSourceIdStrings(row?.extern_source_id);
}

/** Chunked `.in('id', …)` fetch — avoids PostgREST’s default ~1000-row cap on full-table selects. */
export async function fetchMiscLeadsourcesByIds(
  ids: string[],
): Promise<{ id: string; name: string; channel_id: string | null; active?: boolean }[]> {
  const unique = Array.from(
    new Set(ids.map((id) => leadSourceIdToString(id)).filter((id): id is string => Boolean(id))),
  );
  if (unique.length === 0) return [];

  const chunkSize = 150;
  const combined: { id: string; name: string; channel_id: string | null; active?: boolean }[] = [];
  for (let i = 0; i < unique.length; i += chunkSize) {
    const chunk = unique.slice(i, i + chunkSize);
    const { data, error } = await supabase
      .from('misc_leadsource')
      .select('id, name, channel_id, active')
      .in('id', chunk);
    if (error) throw error;
    for (const r of data || []) {
      const id = leadSourceIdToString((r as { id: unknown }).id);
      if (!id) continue;
      combined.push({
        id,
        name: String((r as { name?: string }).name ?? ''),
        channel_id: ((r as { channel_id?: string | null }).channel_id ?? null) as string | null,
        active: (r as { active?: boolean }).active,
      });
    }
  }
  combined.sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }));
  return combined;
}
