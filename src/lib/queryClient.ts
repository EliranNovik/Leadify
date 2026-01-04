import { QueryClient } from '@tanstack/react-query';

/**
 * React Query client with optimized settings for data caching
 * This prevents refetches when navigating back to pages
 */
export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      // Cache data for 5 minutes
      staleTime: 5 * 60 * 1000,
      // Keep unused data in cache for 10 minutes
      gcTime: 10 * 60 * 1000,
      // Refetch on window focus - set to false to prevent refetches when returning to tab
      refetchOnWindowFocus: false,
      // Don't refetch on reconnect
      refetchOnReconnect: false,
      // Retry failed requests once
      retry: 1,
    },
  },
});

