import { useState, useEffect, useRef } from 'react';
import { useLocation, useNavigationType } from 'react-router-dom';
import { getCachedData, setCachedData } from '../utils/dataCache';
import { getMobileAwareCacheTtlMs } from '../lib/mobileCache';
import { useRefetchOnVisible } from './useRefetchOnVisible';

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
  const lastFetchedAtRef = useRef(0);

  const runFetch = (skipCacheRead: boolean) => {
    if (!skipCacheRead) {
      const cached = getCachedData<T>(pathnameRef.current, cacheKey);
      if (cached) {
        setData(cached);
        setLoading(false);
        setError(null);
        return Promise.resolve(cached);
      }
    }
    setLoading(true);
    setError(null);
    return fetchFnRef
      .current()
      .then((result) => {
        setData(result);
        setCachedData(pathnameRef.current, cacheKey, result);
        setError(null);
        lastFetchedAtRef.current = Date.now();
        return result;
      })
      .catch((err) => {
        setError(err);
        setData(null);
        throw err;
      })
      .finally(() => {
        setLoading(false);
      });
  };

  // Update refs when they change
  useEffect(() => {
    fetchFnRef.current = fetchFn;
    pathnameRef.current = pathname;
  }, [fetchFn, pathname]);

  useRefetchOnVisible({
    enabled: options?.enabled !== false,
    staleMs: getMobileAwareCacheTtlMs(10 * 60 * 1000, 60_000),
    lastFetchedAtRef,
    onRefetch: () => runFetch(true),
  });
  
  useEffect(() => {
    const enabled = options?.enabled !== false;
    if (!enabled) {
      setLoading(false);
      return;
    }
    
    const cached = getCachedData<T>(pathname, cacheKey);

    if (cached && !options?.skipCache) {
      setData(cached);
      setLoading(false);
      setError(null);
      lastFetchedAtRef.current = Date.now();
      return;
    }

    void runFetch(true);
  }, [pathname, cacheKey, options?.enabled, options?.skipCache]);
  
  return { data, loading, error };
}

