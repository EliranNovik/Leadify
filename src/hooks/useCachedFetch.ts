import { useState, useEffect, useRef, useCallback } from 'react';
import { useLocation, useNavigationType } from 'react-router-dom';
import { getCachedData, setCachedData } from '../utils/dataCache';

/**
 * Custom hook to fetch data with automatic caching
 * Prevents refetches when navigating back to a page
 * 
 * Usage:
 * ```tsx
 * const { data, loading, error } = useCachedFetch(
 *   'meetings', // cache key (unique per page)
 *   async () => {
 *     const { data, error } = await supabase.from('meetings').select('*');
 *     if (error) throw error;
 *     return data;
 *   }
 * );
 * ```
 */
export function useCachedFetch<T>(
  cacheKey: string,
  fetchFn: () => Promise<T>,
  options?: {
    enabled?: boolean; // Whether to fetch (default: true)
    skipCache?: boolean; // Skip cache check (default: false)
  }
) {
  const location = useLocation();
  const navType = useNavigationType();
  const pathname = location.pathname;
  
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<Error | null>(null);
  const fetchFnRef = useRef(fetchFn);
  const pathnameRef = useRef(pathname);
  
  // Update refs when they change
  useEffect(() => {
    fetchFnRef.current = fetchFn;
    pathnameRef.current = pathname;
  }, [fetchFn, pathname]);
  
  useEffect(() => {
    const enabled = options?.enabled !== false;
    if (!enabled) {
      setLoading(false);
      return;
    }
    
    // Check cache FIRST before doing anything else
    const cached = getCachedData<T>(pathname, cacheKey);
    
    if (cached && !options?.skipCache) {
      console.log('[useCachedFetch] ✅ Using cached data (no fetch needed):', { pathname, cacheKey, navType });
      setData(cached);
      setLoading(false);
      setError(null);
      return;
    }
    
    // Only fetch if we don't have cached data
    console.log('[useCachedFetch] ❌ No cache found, fetching data:', { pathname, cacheKey, navType, hasCached: !!cached, skipCache: options?.skipCache });
    setLoading(true);
    setError(null);
    
    fetchFnRef.current()
      .then((result) => {
        console.log('[useCachedFetch] ✅ Fetch completed, caching result:', { pathname, cacheKey });
        setData(result);
        setCachedData(pathname, cacheKey, result);
        setError(null);
      })
      .catch((err) => {
        console.error('[useCachedFetch] ❌ Error:', err);
        setError(err);
        setData(null);
      })
      .finally(() => {
        setLoading(false);
      });
  }, [pathname, cacheKey, options?.enabled, options?.skipCache]); // Removed navType from deps to avoid re-running
  
  return { data, loading, error };
}

