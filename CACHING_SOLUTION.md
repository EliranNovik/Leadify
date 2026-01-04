# Data Caching Solution - Prevent Refetches

## Problem

When navigating back to a page, React Router unmounts and remounts components, causing all `useEffect` hooks to run again and refetch data.

## Solution

Use the `useCachedFetch` hook instead of `useEffect` + `useState` for data fetching.

## Quick Migration Guide

### Before (refetches every time):

```tsx
const [meetings, setMeetings] = useState<any[]>([]);
const [loading, setLoading] = useState(true);

useEffect(() => {
  const fetchMeetings = async () => {
    setLoading(true);
    const { data, error } = await supabase.from("meetings").select("*");
    if (error) {
      console.error(error);
    } else {
      setMeetings(data || []);
    }
    setLoading(false);
  };
  fetchMeetings();
}, []);
```

### After (cached, no refetch on back navigation):

```tsx
import { useCachedFetch } from "../hooks/useCachedFetch";

const {
  data: meetings,
  loading,
  error,
} = useCachedFetch(
  "meetings", // unique cache key
  async () => {
    const { data, error } = await supabase.from("meetings").select("*");
    if (error) throw error;
    return data || [];
  }
);
```

## How It Works

1. **First visit**: Fetches data and caches it by pathname + cacheKey
2. **Navigate away**: Cache persists
3. **Navigate back (POP)**: Returns cached data instantly, no refetch
4. **Normal navigation (PUSH)**: Still uses cache if available

## Example: CalendarPage

Replace the main data fetching `useEffect`:

```tsx
// OLD:
useEffect(() => {
  const fetchMeetingsAndStaff = async () => {
    setIsLoading(true);
    // ... fetch logic
    setMeetings(data);
    setIsLoading(false);
  };
  fetchMeetingsAndStaff();
}, []);

// NEW:
const { data: meetingsData, loading: isLoading } = useCachedFetch(
  "meetings-and-staff",
  async () => {
    const { data: employeesData, error: employeesError } = await supabase
      .from("users")
      .select(`...`)
      .eq("is_active", true);

    if (employeesError) throw employeesError;

    // ... rest of fetch logic
    return { meetings: data, employees: employeesData };
  }
);

// Then use meetingsData.meetings and meetingsData.employees
```

## Benefits

- ✅ No refetches when navigating back
- ✅ Instant data loading from cache
- ✅ Simple migration (just wrap existing fetch functions)
- ✅ Works with all Supabase queries
- ✅ Automatic cache invalidation after 30 minutes

## Next Steps

1. Migrate CalendarPage first (main page users navigate to frequently)
2. Then migrate Dashboard, PipelinePage, etc.
3. For complex pages with multiple fetches, use multiple `useCachedFetch` calls with different cache keys
