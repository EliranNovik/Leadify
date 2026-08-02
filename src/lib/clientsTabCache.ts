/**
 * Versioned sessionStorage cache for Clients page tab slices.
 * Cache-first: paint immediately on hit, then silent-refresh in the background.
 */

const CACHE_VERSION = 1;
const CACHE_TTL_MS = 30 * 60 * 1000;
const STORAGE_PREFIX = 'clients-tab-cache:';

export type ClientsTabSlice =
  | 'info'
  | 'meetings'
  | 'price'
  | 'marketing'
  | 'expert'
  | 'roles'
  | 'header';

type StoredSlice<T> = {
  v: number;
  at: number;
  data: T;
};

/** Stable per-lead key (legacy vs new). Avoids master/sublead collisions on shared lead_number. */
export function clientsTabCacheLeadKey(
  client: { id?: string | number | null; lead_type?: string | null } | null | undefined,
): string | null {
  if (!client?.id && client?.id !== 0) return null;
  const idStr = String(client.id);
  const isLegacy = client.lead_type === 'legacy' || idStr.startsWith('legacy_');
  if (isLegacy) {
    const legacyId = idStr.replace(/^legacy_/, '');
    return legacyId ? `legacy:${legacyId}` : null;
  }
  return `new:${idStr.toLowerCase()}`;
}

function storageKey(leadKey: string, slice: ClientsTabSlice): string {
  return `${STORAGE_PREFIX}${leadKey}:${slice}`;
}

export function readClientsTabCache<T>(
  leadKey: string | null | undefined,
  slice: ClientsTabSlice,
): T | null {
  if (!leadKey || typeof window === 'undefined') return null;
  try {
    const raw = sessionStorage.getItem(storageKey(leadKey, slice));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as StoredSlice<T>;
    if (parsed.v !== CACHE_VERSION) return null;
    if (Date.now() - parsed.at > CACHE_TTL_MS) return null;
    return parsed.data ?? null;
  } catch {
    return null;
  }
}

export function writeClientsTabCache<T>(
  leadKey: string | null | undefined,
  slice: ClientsTabSlice,
  data: T,
): void {
  if (!leadKey || typeof window === 'undefined') return;
  try {
    const payload: StoredSlice<T> = { v: CACHE_VERSION, at: Date.now(), data };
    sessionStorage.setItem(storageKey(leadKey, slice), JSON.stringify(payload));
  } catch {
    /* quota or private mode */
  }
}

export function clearClientsTabCacheSlice(
  leadKey: string | null | undefined,
  slice: ClientsTabSlice,
): void {
  if (!leadKey || typeof window === 'undefined') return;
  try {
    sessionStorage.removeItem(storageKey(leadKey, slice));
  } catch {
    /* ignore */
  }
}

export function clearAllClientsTabCacheForLead(leadKey: string | null | undefined): void {
  if (!leadKey || typeof window === 'undefined') return;
  const slices: ClientsTabSlice[] = ['info', 'meetings', 'price', 'marketing', 'expert', 'roles', 'header'];
  for (const slice of slices) {
    clearClientsTabCacheSlice(leadKey, slice);
  }
}
