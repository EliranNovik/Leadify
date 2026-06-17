/**
 * Global Data Cache
 * Stores fetched data to prevent refetches when navigating back to pages
 */

interface CacheEntry<T = any> {
  data: T;
  timestamp: number;
  pathname: string;
}

// Global cache: pathname -> cacheKey -> CacheEntry
const dataCache = new Map<string, Map<string, CacheEntry>>();

import { getMobileAwareCacheTtlMs } from '../lib/mobileCache';

function getCacheDurationMs(): number {
  return getMobileAwareCacheTtlMs(30 * 60 * 1000, 5 * 60 * 1000);
}
const STORAGE_KEY = 'data_cache';
const CACHE_DEBUG = import.meta.env.DEV && import.meta.env.VITE_DATA_CACHE_DEBUG === 'true';

let saveCacheTimer: ReturnType<typeof setTimeout> | null = null;

function cacheLog(...args: unknown[]) {
  if (CACHE_DEBUG) console.log(...args);
}

function cacheWarn(...args: unknown[]) {
  if (CACHE_DEBUG) console.warn(...args);
}

// Load cache from sessionStorage on initialization
function loadCacheFromStorage() {
  try {
    const stored = sessionStorage.getItem(STORAGE_KEY);
    if (stored) {
      const parsed = JSON.parse(stored) as Array<[string, Array<[string, CacheEntry]>]>;
      parsed.forEach(([pathname, cacheEntries]) => {
        const routeCache = new Map<string, CacheEntry>();
        cacheEntries.forEach(([cacheKey, entry]) => {
          // Check if cache is still valid
          const age = Date.now() - entry.timestamp;
          if (age <= getCacheDurationMs()) {
            routeCache.set(cacheKey, entry);
          }
        });
        if (routeCache.size > 0) {
          dataCache.set(pathname, routeCache);
        }
      });
      cacheLog('[dataCache] Loaded cache from sessionStorage:', { 
        pathnames: Array.from(dataCache.keys()),
        totalEntries: Array.from(dataCache.values()).reduce((sum, m) => sum + m.size, 0)
      });
    }
  } catch (e) {
    cacheWarn('[dataCache] Failed to load from sessionStorage:', e);
  }
}

// Save cache to sessionStorage (debounced to avoid blocking the main thread)
function saveCacheToStorage() {
  if (saveCacheTimer) clearTimeout(saveCacheTimer);
  saveCacheTimer = setTimeout(() => {
    saveCacheTimer = null;
    try {
      const cacheArray = Array.from(dataCache.entries()).map(([pathname, routeCache]) => [
        pathname,
        Array.from(routeCache.entries())
      ]);
      sessionStorage.setItem(STORAGE_KEY, JSON.stringify(cacheArray));
    } catch (e) {
      cacheWarn('[dataCache] Failed to save to sessionStorage:', e);
    }
  }, 300);
}

// Load cache on module initialization
loadCacheFromStorage();

/**
 * Get cached data for a specific route and cache key
 */
export function getCachedData<T>(pathname: string, cacheKey: string): T | null {
  const routeCache = dataCache.get(pathname);
  if (!routeCache) {
    cacheLog('[dataCache] No cache for pathname:', pathname);
    return null;
  }
  
  const entry = routeCache.get(cacheKey);
  if (!entry) {
    cacheLog('[dataCache] No cache entry for key:', { pathname, cacheKey, availableKeys: Array.from(routeCache.keys()) });
    return null;
  }
  
  // Check if cache is stale
  const age = Date.now() - entry.timestamp;
  if (age > getCacheDurationMs()) {
    cacheLog('[dataCache] Cache expired:', { pathname, cacheKey, age });
    routeCache.delete(cacheKey);
    return null;
  }
  
  cacheLog('[dataCache] Cache hit:', { pathname, cacheKey, age: Math.round(age / 1000) + 's' });
  return entry.data as T;
}

/**
 * Set cached data for a specific route and cache key
 */
export function setCachedData<T>(pathname: string, cacheKey: string, data: T): void {
  let routeCache = dataCache.get(pathname);
  if (!routeCache) {
    routeCache = new Map();
    dataCache.set(pathname, routeCache);
  }
  
  routeCache.set(cacheKey, {
    data,
    timestamp: Date.now(),
    pathname,
  });
  
  // Save to sessionStorage for persistence
  saveCacheToStorage();
  
  cacheLog('[dataCache] Cached data:', { pathname, cacheKey, cacheSize: routeCache.size, hasData: !!data });
}

/**
 * Clear cache for a specific route or all routes
 */
export function clearCache(pathname?: string): void {
  if (pathname) {
    dataCache.delete(pathname);
    saveCacheToStorage();
    cacheLog('[dataCache] Cleared cache for:', pathname);
  } else {
    dataCache.clear();
    try {
      sessionStorage.removeItem(STORAGE_KEY);
    } catch (e) {
      // Ignore
    }
    cacheLog('[dataCache] Cleared all cache');
  }
}

/**
 * Clear stale entries
 */
export function clearStaleCache(): void {
  const now = Date.now();
  for (const [pathname, routeCache] of dataCache.entries()) {
    for (const [cacheKey, entry] of routeCache.entries()) {
      const age = now - entry.timestamp;
      if (age > getCacheDurationMs()) {
        routeCache.delete(cacheKey);
      }
    }
    // Remove empty route caches
    if (routeCache.size === 0) {
      dataCache.delete(pathname);
    }
  }
}

