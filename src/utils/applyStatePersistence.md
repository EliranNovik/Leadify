# State Persistence Guide - Apply Across All Pages

This guide shows how to apply state persistence to ALL pages in your web app.

## Quick Migration Pattern

For any page with filters, search results, or UI state:

### Step 1: Import the hook
```typescript
import { usePersistedFilters, usePersistedState } from '../hooks/usePersistedState';
```

### Step 2: Replace useState with usePersistedFilters/usePersistedState

**Before:**
```typescript
const [filters, setFilters] = useState({ ... });
const [results, setResults] = useState([]);
const [searchPerformed, setSearchPerformed] = useState(false);
const [viewMode, setViewMode] = useState('cards');
```

**After:**
```typescript
const [filters, setFilters] = usePersistedFilters('pageName_filters', { ... }, {
  storage: 'sessionStorage',
});
const [results, setResults] = usePersistedFilters('pageName_results', [], {
  storage: 'sessionStorage',
});
const [searchPerformed, setSearchPerformed] = usePersistedFilters('pageName_performed', false, {
  storage: 'sessionStorage',
});
const [viewMode, setViewMode] = usePersistedFilters('pageName_viewMode', 'cards', {
  storage: 'sessionStorage',
});
```

## Pages to Update

### 1. ✅ LeadSearchPage (`src/pages/LeadSearchPage.tsx`)
**Status:** Already updated with filters, results, searchPerformed, viewMode, and columns

### 2. ReportsPage (`src/pages/ReportsPage.tsx`)
Update each report component:

#### StageSearchReport
```typescript
// Replace:
const [filters, setFilters] = useState({ ... });
const [results, setResults] = useState<any[]>([]);
const [searchPerformed, setSearchPerformed] = useState(false);

// With:
import { usePersistedFilters } from '../hooks/usePersistedState';

const [filters, setFilters] = usePersistedFilters('reports_stageSearch_filters', { ... }, {
  storage: 'sessionStorage',
});
const [results, setResults] = usePersistedFilters('reports_stageSearch_results', [], {
  storage: 'sessionStorage',
});
const [searchPerformed, setSearchPerformed] = usePersistedFilters('reports_stageSearch_performed', false, {
  storage: 'sessionStorage',
});
```

#### AnchorSearchReport
```typescript
const [filters, setFilters] = usePersistedFilters('reports_anchorSearch_filters', { ... }, {
  storage: 'sessionStorage',
});
const [results, setResults] = usePersistedFilters('reports_anchorSearch_results', [], {
  storage: 'sessionStorage',
});
const [searchPerformed, setSearchPerformed] = usePersistedFilters('reports_anchorSearch_performed', false, {
  storage: 'sessionStorage',
});
```

#### SchedulerSuperPipelineReport
```typescript
const [filters, setFilters] = usePersistedFilters('reports_schedulerPipeline_filters', { ... }, {
  storage: 'sessionStorage',
});
const [results, setResults] = usePersistedFilters('reports_schedulerPipeline_results', [], {
  storage: 'sessionStorage',
});
const [searchPerformed, setSearchPerformed] = usePersistedFilters('reports_schedulerPipeline_performed', false, {
  storage: 'sessionStorage',
});
```

#### ExpertsResultsReport
```typescript
const [filters, setFilters] = usePersistedFilters('reports_expertsResults_filters', { ... }, {
  storage: 'sessionStorage',
});
const [results, setResults] = usePersistedFilters('reports_expertsResults_results', [], {
  storage: 'sessionStorage',
});
const [searchPerformed, setSearchPerformed] = usePersistedFilters('reports_expertsResults_performed', false, {
  storage: 'sessionStorage',
});
```

### 3. FullSearchReport (`src/pages/FullSearchReport.tsx`)
```typescript
const [filters, setFilters] = usePersistedFilters('fullSearch_filters', { ... }, {
  storage: 'sessionStorage',
});
const [results, setResults] = usePersistedFilters('fullSearch_results', [], {
  storage: 'sessionStorage',
});
const [searchPerformed, setSearchPerformed] = usePersistedFilters('fullSearch_performed', false, {
  storage: 'sessionStorage',
});
```

### 4. SchedulerToolPage (`src/pages/SchedulerToolPage.tsx`)
```typescript
const [filters, setFilters] = usePersistedFilters('schedulerTool_filters', { ... }, {
  storage: 'sessionStorage',
});
const [filteredLeads, setFilteredLeads] = usePersistedFilters('schedulerTool_filteredLeads', [], {
  storage: 'sessionStorage',
});
const [searchTerm, setSearchTerm] = usePersistedFilters('schedulerTool_searchTerm', '', {
  storage: 'sessionStorage',
});
const [dateFrom, setDateFrom] = usePersistedFilters('schedulerTool_dateFrom', '', {
  storage: 'sessionStorage',
});
const [dateTo, setDateTo] = usePersistedFilters('schedulerTool_dateTo', '', {
  storage: 'sessionStorage',
});
const [sortConfig, setSortConfig] = usePersistedFilters('schedulerTool_sortConfig', { key: null, direction: null }, {
  storage: 'sessionStorage',
});
```

### 5. NewCasesPage (`src/pages/NewCasesPage.tsx`)
Apply to any filter/search state

### 6. MyCasesPage (`src/pages/MyCasesPage.tsx`)
Apply to any filter/search state

### 7. CalendarPage (`src/components/CalendarPage.tsx`)
Apply to date filters, view mode, etc.

### 8. PipelinePage (`src/components/PipelinePage.tsx`)
Apply to filters and view state

## Key Points

1. **Use unique keys** - Format: `'pageName_componentName_stateName'`
   - Example: `'reports_stageSearch_filters'` not just `'filters'`

2. **Persist everything** - Not just filters, but also:
   - Search results
   - Search performed flag
   - View mode (cards/table)
   - Selected columns
   - Sort configuration
   - Date ranges
   - Any UI state that should persist

3. **Use sessionStorage** - For most cases, use `sessionStorage` (clears on browser close)
   - Use `localStorage` only for user preferences that should persist across sessions

4. **Don't persist**:
   - Loading states (`isSearching`, `isLoading`)
   - Dropdown visibility states
   - Modal open/close states
   - Temporary UI states

## Testing Checklist

After updating each page:
- [ ] Navigate to page
- [ ] Set filters/search
- [ ] Perform search
- [ ] Navigate away to another page
- [ ] Navigate back
- [ ] Verify filters are restored
- [ ] Verify results are restored
- [ ] Verify view mode is restored (if applicable)

## Bulk Update Script

You can use find/replace in your editor:

**Find:**
```typescript
const \[filters, setFilters\] = useState\(
```

**Replace:**
```typescript
const [filters, setFilters] = usePersistedFilters('PAGE_KEY_filters', 
```

Then manually:
1. Add the import at the top
2. Add the closing options object
3. Update the key for each component

