# Meetings Caching Plan

The meetings data is complex and date-dependent. To cache it properly, we need to:

1. Cache meetings with a key that includes the date range
2. The cache key should be: `calendar-meetings-${appliedFromDate}-${appliedToDate}`
3. However, the code fetches:
   - Today's meetings first (for immediate display)
   - Then all meetings in the background
   - Then legacy meetings for the date range
   - Then staff meetings

This is very complex to cache. A simpler approach:

## Option 1: Cache the entire meetings fetch
- Wrap the entire `fetchMeetingsAndStaff` function in a cache
- Cache key: `calendar-meetings-${appliedFromDate}-${appliedToDate}`
- Problem: This is a huge function with many side effects

## Option 2: Prevent useEffect from running on POP navigation
- Check if we're on a POP navigation
- If yes, and we have cached meetings for this date range, skip the fetch
- This is simpler but requires checking navigation type

## Option 3: Use useCachedFetch for meetings
- Extract the meetings fetch logic into a separate function
- Use useCachedFetch with a date-based cache key
- Problem: The fetch logic is deeply integrated with the component

## Recommendation: Option 2 (Simplest)
- Check navigation type before running the main useEffect
- If POP navigation and we have cached meetings, skip the fetch
- This prevents refetches while keeping the code simple

