# State Persistence Hook

## Overview

The `usePersistedState` hook allows you to persist component state across page navigation. This is perfect for preserving filters, form inputs, and other UI state when users navigate away and come back to a page.

## Features

- ✅ **Automatic persistence** - State is saved automatically when it changes
- ✅ **Multiple storage options** - localStorage, sessionStorage, URL params, or both
- ✅ **Type-safe** - Full TypeScript support
- ✅ **Easy to use** - Drop-in replacement for `useState`
- ✅ **URL sync** - Optional URL query parameter synchronization for shareable/bookmarkable state

## Basic Usage

### Simple Example

```typescript
import { usePersistedState } from '../hooks/usePersistedState';

function MyComponent() {
  // Replace useState with usePersistedState
  const [filters, setFilters] = usePersistedState('myFilters', {
    search: '',
    category: '',
    date: '',
  }, {
    storage: 'sessionStorage', // or 'localStorage', 'url', 'both'
  });

  // Use filters and setFilters exactly like useState
  return (
    <input 
      value={filters.search}
      onChange={(e) => setFilters({ ...filters, search: e.target.value })}
    />
  );
}
```

### For Filter Pages (Recommended)

```typescript
import { usePersistedFilters } from '../hooks/usePersistedState';

function ReportsPage() {
  // usePersistedFilters is a convenience wrapper for filter states
  const [filters, setFilters] = usePersistedFilters('reports', {
    fromDate: '',
    toDate: '',
    category: '',
    status: '',
  }, {
    storage: 'sessionStorage',
    syncWithUrl: true, // Makes filters shareable via URL
  });

  // Rest of your component...
}
```

## Storage Options

### `sessionStorage` (Recommended for filters)
- Persists for the browser session
- Clears when browser closes
- Good for temporary filters and UI state

### `localStorage`
- Persists indefinitely until manually cleared
- Good for user preferences and settings

### `url`
- Stores state in URL query parameters
- Makes state shareable and bookmarkable
- Good for search results and filters that should be shareable

### `both`
- Uses both localStorage and sessionStorage
- Provides redundancy

## Advanced Usage

### With URL Synchronization

```typescript
const [filters, setFilters] = usePersistedState('search', initialState, {
  storage: 'sessionStorage',
  syncWithUrl: true,        // Enable URL sync
  urlKey: 'filters',        // Custom URL param name (optional)
});
```

### Clearing State

```typescript
const [filters, setFilters, clearFilters] = usePersistedState('search', initialState);

// Clear persisted state
const handleReset = () => {
  clearFilters(); // Resets to initialState and clears storage
};
```

## Migration Guide

### Before (using useState)
```typescript
const [filters, setFilters] = useState({
  search: '',
  category: '',
});
```

### After (using usePersistedState)
```typescript
const [filters, setFilters] = usePersistedState('myPageFilters', {
  search: '',
  category: '',
}, {
  storage: 'sessionStorage',
});
```

That's it! The state will now persist across navigation.

## Examples in Codebase

- **LeadSearchPage**: Uses `usePersistedFilters` to persist search filters
- **ReportsPage**: Can be updated to use `usePersistedFilters` for each report component

## Best Practices

1. **Use sessionStorage for filters** - Filters are usually temporary and should clear when the browser closes
2. **Use localStorage for preferences** - User settings should persist across sessions
3. **Use URL sync for shareable state** - When users should be able to share/bookmark filtered views
4. **Choose unique keys** - Use descriptive, unique keys to avoid conflicts (e.g., `'leadSearchFilters'` not `'filters'`)
5. **Handle date objects carefully** - Dates should be stored as ISO strings, not Date objects

## Troubleshooting

### State not persisting?
- Check browser console for errors
- Verify storage is not disabled in browser settings
- Check that the key is unique and not conflicting with other components

### State persisting too long?
- Use `sessionStorage` instead of `localStorage`
- Call `clearState()` when appropriate (e.g., on logout)

### URL getting too long?
- Only use URL sync for essential filters
- Consider compressing complex state before storing in URL

