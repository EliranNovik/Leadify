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

const CACHE_DURATION = 30 * 60 * 1000; // 30 minutes
const STORAGE_KEY = 'data_cache';

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
          if (age <= CACHE_DURATION) {
            routeCache.set(cacheKey, entry);
          }
        });
        if (routeCache.size > 0) {
          dataCache.set(pathname, routeCache);
        }
      });
      console.log('[dataCache] Loaded cache from sessionStorage:', { 
        pathnames: Array.from(dataCache.keys()),
        totalEntries: Array.from(dataCache.values()).reduce((sum, m) => sum + m.size, 0)
      });
    }
  } catch (e) {
    console.warn('[dataCache] Failed to load from sessionStorage:', e);
  }
}

// Save cache to sessionStorage
function saveCacheToStorage() {
  try {
    const cacheArray = Array.from(dataCache.entries()).map(([pathname, routeCache]) => [
      pathname,
      Array.from(routeCache.entries())
    ]);
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify(cacheArray));
  } catch (e) {
    console.warn('[dataCache] Failed to save to sessionStorage:', e);
  }
}

// Load cache on module initialization
loadCacheFromStorage();

/**
 * Get cached data for a specific route and cache key
 */
export function getCachedData<T>(pathname: string, cacheKey: string): T | null {
  const routeCache = dataCache.get(pathname);
  if (!routeCache) {
    console.log('[dataCache] No cache for pathname:', pathname);
    return null;
  }
  
  const entry = routeCache.get(cacheKey);
  if (!entry) {
    console.log('[dataCache] No cache entry for key:', { pathname, cacheKey, availableKeys: Array.from(routeCache.keys()) });
    return null;
  }
  
  // Check if cache is stale
  const age = Date.now() - entry.timestamp;
  if (age > CACHE_DURATION) {
    console.log('[dataCache] Cache expired:', { pathname, cacheKey, age });
    routeCache.delete(cacheKey);
    return null;
  }
  
  console.log('[dataCache] Cache hit:', { pathname, cacheKey, age: Math.round(age / 1000) + 's' });
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
  
  console.log('[dataCache] Cached data:', { pathname, cacheKey, cacheSize: routeCache.size, hasData: !!data });
}

/**
 * Clear cache for a specific route or all routes
 */
export function clearCache(pathname?: string): void {
  if (pathname) {
    dataCache.delete(pathname);
    saveCacheToStorage();
    console.log('[dataCache] Cleared cache for:', pathname);
  } else {
    dataCache.clear();
    try {
      sessionStorage.removeItem(STORAGE_KEY);
    } catch (e) {
      // Ignore
    }
    console.log('[dataCache] Cleared all cache');
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
      if (age > CACHE_DURATION) {
        routeCache.delete(cacheKey);
      }
    }
    // Remove empty route caches
    if (routeCache.size === 0) {
      dataCache.delete(pathname);
    }
  }
}

