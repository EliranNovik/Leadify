import { useQuery, UseQueryOptions } from '@tanstack/react-query';
import { SupabaseClient } from '@supabase/supabase-js';
import { supabase } from '../lib/supabase';

/**
 * Custom hook to use Supabase queries with React Query caching
 * This prevents refetches when navigating back to pages
 * 
 * Example usage:
 * ```ts
 * const { data, isLoading, error } = useSupabaseQuery(
 *   ['calendar-meetings', dateRange],
 *   async () => {
 *     const { data, error } = await supabase
 *       .from('meetings')
 *       .select('*')
 *       .gte('date', fromDate)
 *       .lte('date', toDate);
 *     if (error) throw error;
 *     return data;
 *   }
 * );
 * ```
 */
export function useSupabaseQuery<TData = unknown, TError = Error>(
  queryKey: (string | number | boolean | null | undefined)[],
  queryFn: () => Promise<TData>,
  options?: Omit<UseQueryOptions<TData, TError>, 'queryKey' | 'queryFn'>
) {
  return useQuery<TData, TError>({
    queryKey,
    queryFn,
    ...options,
  });
}

