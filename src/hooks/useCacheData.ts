import { useRef, useEffect } from 'react';
import { useLocation, useNavigationType } from 'react-router-dom';

interface CacheEntry<T> {
  data: T;
  timestamp: number;
  pathname: string;
}

// Global cache storage
const dataCache = new Map<string, CacheEntry<any>>();
const CACHE_DURATION = 30 * 60 * 1000; // 30 minutes

/**
 * useCacheData - Hook to cache and retrieve data to prevent refetches
 * Usage: const { cachedData, setCachedData, shouldFetch } = useCacheData<DataType>(cacheKey);
 */
export function useCacheData<T>(cacheKey: string) {
  const location = useLocation();
  const navType = useNavigationType();
  const cacheKeyRef = useRef<string>(`${cacheKey}_${location.pathname}`);

  // Update cache key when location changes
  useEffect(() => {
    cacheKeyRef.current = `${cacheKey}_${location.pathname}`;
  }, [location.pathname, cacheKey]);

  const getCachedData = (): T | null => {
    const key = cacheKeyRef.current;
    const entry = dataCache.get(key);
    
    if (!entry) return null;
    
    // Check if cache is still valid
    const age = Date.now() - entry.timestamp;
    if (age > CACHE_DURATION) {
      dataCache.delete(key);
      return null;
    }
    
    return entry.data as T;
  };

  const setCachedData = (data: T) => {
    const key = cacheKeyRef.current;
    dataCache.set(key, {
      data,
      timestamp: Date.now(),
      pathname: location.pathname,
    });

    // Also save to sessionStorage for persistence across page reloads
    try {
      const cacheArray = Array.from(dataCache.entries()).map(([k, v]) => [k, {
        data: v.data,
        timestamp: v.timestamp,
        pathname: v.pathname,
      }]);
      sessionStorage.setItem(`data_cache_${cacheKey}`, JSON.stringify(cacheArray));
    } catch (e) {
      // Ignore storage errors
    }
  };

  const shouldFetch = (): boolean => {
    // If this is a back/forward navigation (POP), check cache first
    if (navType === 'POP') {
      const cached = getCachedData();
      return cached === null;
    }
    
    // For normal navigation, always fetch (or check cache based on your needs)
    return true;
  };

  return {
    cachedData: getCachedData(),
    setCachedData,
    shouldFetch,
    clearCache: () => {
      const key = cacheKeyRef.current;
      dataCache.delete(key);
      try {
        sessionStorage.removeItem(`data_cache_${cacheKey}`);
      } catch (e) {
        // Ignore
      }
    },
  };
}

/**
 * Load cache from sessionStorage on app start
 */
export function loadDataCacheFromStorage(cacheKey: string) {
  try {
    const stored = sessionStorage.getItem(`data_cache_${cacheKey}`);
    if (stored) {
      const parsed = JSON.parse(stored) as Array<[string, CacheEntry<any>]>;
      parsed.forEach(([key, value]) => {
        // Only load if cache is still valid
        const age = Date.now() - value.timestamp;
        if (age <= CACHE_DURATION) {
          dataCache.set(key, value);
        }
      });
    }
  } catch (e) {
    // Ignore
  }
}

