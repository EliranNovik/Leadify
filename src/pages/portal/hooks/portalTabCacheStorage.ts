import type { PortalTabCacheData } from './usePortalTabCache';

const CACHE_VERSION = 3;
const CACHE_TTL_MS = 30 * 60 * 1000;

type StoredPortalCache = {
  v: number;
  at: number;
  data: PortalTabCacheData;
};

function storageKey(leadRef: string): string {
  return `portal-tab-cache:${leadRef}`;
}

export function readPortalTabCache(leadRef: string | null | undefined): PortalTabCacheData | null {
  if (!leadRef || typeof window === 'undefined') return null;
  try {
    const raw = sessionStorage.getItem(storageKey(leadRef));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as StoredPortalCache;
    if (parsed.v !== CACHE_VERSION) return null;
    if (Date.now() - parsed.at > CACHE_TTL_MS) return null;
    return parsed.data ?? null;
  } catch {
    return null;
  }
}

export function writePortalTabCache(leadRef: string | null | undefined, data: PortalTabCacheData): void {
  if (!leadRef || typeof window === 'undefined') return;
  try {
    const payload: StoredPortalCache = { v: CACHE_VERSION, at: Date.now(), data };
    sessionStorage.setItem(storageKey(leadRef), JSON.stringify(payload));
  } catch {
    /* quota or private mode */
  }
}

export function clearPortalTabCache(leadRef: string | null | undefined): void {
  if (!leadRef || typeof window === 'undefined') return;
  try {
    sessionStorage.removeItem(storageKey(leadRef));
  } catch {
    /* ignore */
  }
}
