/**
 * Route Cache Utility
 * Global cache to store route component instances and their state
 */

export interface CachedRouteInstance {
  componentKey: string;
  scrollPosition: number;
  pathname: string;
  timestamp: number;
  // Store any additional state that needs to be preserved
  state?: Record<string, any>;
}

// Global cache map: pathname -> CachedRouteInstance
const routeInstanceCache = new Map<string, CachedRouteInstance>();

/**
 * Save a route instance to cache
 */
export function cacheRouteInstance(pathname: string, scrollPosition: number, state?: Record<string, any>) {
  const cacheEntry = {
    componentKey: pathname,
    scrollPosition,
    pathname,
    timestamp: Date.now(),
    state,
  };
  
  routeInstanceCache.set(pathname, cacheEntry);
  
  console.log('[routeCache] Cached route instance:', {
    pathname,
    scrollPosition,
    timestamp: cacheEntry.timestamp,
    cacheSize: routeInstanceCache.size,
    allCachedPaths: Array.from(routeInstanceCache.keys()),
  });
  
  // Also save to sessionStorage for persistence
  try {
    const cacheArray = Array.from(routeInstanceCache.entries()).map(([key, value]) => [key, value]);
    sessionStorage.setItem('route_cache', JSON.stringify(cacheArray));
    console.log('[routeCache] Saved to sessionStorage, cache size:', cacheArray.length);
  } catch (e) {
    console.warn('[routeCache] Failed to save to sessionStorage:', e);
  }
}

/**
 * Get a cached route instance
 */
export function getCachedRouteInstance(pathname: string): CachedRouteInstance | undefined {
  const cached = routeInstanceCache.get(pathname);
  console.log('[routeCache] Getting cached route instance:', {
    pathname,
    found: !!cached,
    cachedData: cached ? {
      scrollPosition: cached.scrollPosition,
      timestamp: cached.timestamp,
      age: Date.now() - cached.timestamp,
    } : null,
    allCachedPaths: Array.from(routeInstanceCache.keys()),
    cacheSize: routeInstanceCache.size,
  });
  return cached;
}

/**
 * Update scroll position for a cached route
 */
export function updateCachedScrollPosition(pathname: string, scrollPosition: number) {
  const cached = routeInstanceCache.get(pathname);
  if (cached) {
    cached.scrollPosition = scrollPosition;
    cached.timestamp = Date.now();
    
    // Update sessionStorage
    try {
      const cacheArray = Array.from(routeInstanceCache.entries()).map(([key, value]) => [key, value]);
      sessionStorage.setItem('route_cache', JSON.stringify(cacheArray));
    } catch (e) {
      // Ignore
    }
  }
}

/**
 * Clear the cache
 */
export function clearRouteCache() {
  routeInstanceCache.clear();
  try {
    sessionStorage.removeItem('route_cache');
  } catch (e) {
    // Ignore
  }
}

/**
 * Load cache from sessionStorage
 */
export function loadRouteCacheFromStorage() {
  try {
    const stored = sessionStorage.getItem('route_cache');
    console.log('[routeCache] Loading from sessionStorage:', {
      hasStored: !!stored,
      storedLength: stored?.length || 0,
    });
    
    if (stored) {
      const parsed = JSON.parse(stored) as Array<[string, CachedRouteInstance]>;
      console.log('[routeCache] Parsed cache entries:', parsed.length);
      
      parsed.forEach(([key, value]) => {
        routeInstanceCache.set(key, value);
        console.log('[routeCache] Loaded entry:', {
          pathname: key,
          scrollPosition: value.scrollPosition,
          timestamp: value.timestamp,
        });
      });
      
      console.log('[routeCache] Loaded', routeInstanceCache.size, 'entries from sessionStorage');
      return true;
    } else {
      console.log('[routeCache] No cached data in sessionStorage');
    }
  } catch (e) {
    console.warn('[routeCache] Failed to load from sessionStorage:', e);
  }
  return false;
}

/**
 * Get all cached route pathnames
 */
export function getCachedRoutePathnames(): string[] {
  return Array.from(routeInstanceCache.keys());
}

