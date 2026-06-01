import { QueryClient } from '@tanstack/react-query';

/**
 * React Query client with optimized settings for data caching
 * This prevents refetches when navigating back to pages
 */
export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      // Cache data briefly; pages using useSupabaseQuery still benefit from shared defaults.
      staleTime: 2 * 60 * 1000,
      gcTime: 10 * 60 * 1000,
      // Refresh when user returns to the tab (important on mobile after backgrounding).
      refetchOnWindowFocus: true,
      refetchOnReconnect: true,
      // Retry failed requests once
      retry: 1,
    },
  },
});

