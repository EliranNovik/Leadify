# React Query Migration Guide

React Query has been installed to prevent data refetching when navigating back/forward between pages.

## How It Works

React Query automatically caches all query results. When you navigate away and come back:

- ✅ Data is served from cache instantly (no loading state)
- ✅ No refetch happens unless data is stale (>5 minutes old)
- ✅ Scroll position is also restored (separate system)

## Quick Migration Example

**Before (refetches every time):**

```tsx
useEffect(() => {
  const fetchData = async () => {
    const { data } = await supabase.from("table").select("*");
    setData(data);
  };
  fetchData();
}, []);
```

**After (cached, no refetch):**

```tsx
import { useSupabaseQuery } from "../hooks/useSupabaseQuery";

const { data, isLoading, error } = useSupabaseQuery(
  ["myData"], // unique cache key
  async () => {
    const { data, error } = await supabase.from("table").select("*");
    if (error) throw error;
    return data;
  }
);

// data is automatically cached and won't refetch on back/forward navigation
```

## Migration Priority

Start with pages that users navigate back/forward frequently:

1. Dashboard
2. CalendarPage
3. PipelinePage
4. Clients page

## Benefits

- ✅ No refetches when navigating back
- ✅ Instant data loading from cache
- ✅ Automatic error handling
- ✅ Loading states built-in
- ✅ Works with scroll restoration

## Notes

- Cache duration: 5 minutes (configurable in `src/lib/queryClient.ts`)
- Data older than 5 minutes will refetch in background
- Window focus doesn't trigger refetch (configurable)
