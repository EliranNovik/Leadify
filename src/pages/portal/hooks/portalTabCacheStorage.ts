import type { PortalLeadSummary } from '../../../lib/portalApi';
import type { PortalTabCacheData } from './usePortalTabCache';

const CACHE_VERSION = 4;
const CACHE_TTL_MS = 30 * 60 * 1000;

type StoredPortalCache = {
  v: number;
  at: number;
  data: PortalTabCacheData;
};

function storageKey(cacheKey: string): string {
  return `portal-tab-cache:${cacheKey}`;
}

/**
 * Prefer a stable per-lead key. URL lead_number is ambiguous for legacy master vs
 * sublead (often the same digits), which caused Finance to flash the master's plan.
 */
export function portalTabCacheKey(
  leadSummary: PortalLeadSummary | null | undefined,
  leadRef: string | null | undefined,
): string | null {
  if (leadSummary?.is_legacy && leadSummary.legacy_lead_id != null) {
    return `legacy:${leadSummary.legacy_lead_id}`;
  }
  if (leadSummary?.new_lead_id) {
    return `new:${String(leadSummary.new_lead_id).toLowerCase()}`;
  }
  if (!leadRef) return null;
  try {
    return `ref:${decodeURIComponent(String(leadRef))}`;
  } catch {
    return `ref:${String(leadRef)}`;
  }
}

export function readPortalTabCache(cacheKey: string | null | undefined): PortalTabCacheData | null {
  if (!cacheKey || typeof window === 'undefined') return null;
  try {
    const raw = sessionStorage.getItem(storageKey(cacheKey));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as StoredPortalCache;
    if (parsed.v !== CACHE_VERSION) return null;
    if (Date.now() - parsed.at > CACHE_TTL_MS) return null;
    return parsed.data ?? null;
  } catch {
    return null;
  }
}

export function writePortalTabCache(
  cacheKey: string | null | undefined,
  data: PortalTabCacheData,
): void {
  if (!cacheKey || typeof window === 'undefined') return;
  try {
    const payload: StoredPortalCache = { v: CACHE_VERSION, at: Date.now(), data };
    sessionStorage.setItem(storageKey(cacheKey), JSON.stringify(payload));
  } catch {
    /* quota or private mode */
  }
}

export function clearPortalTabCache(cacheKey: string | null | undefined): void {
  if (!cacheKey || typeof window === 'undefined') return;
  try {
    sessionStorage.removeItem(storageKey(cacheKey));
  } catch {
    /* ignore */
  }
}
