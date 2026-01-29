# Sales Contribution Page Refactoring Analysis

## Current Issues Identified

### 1. **Duplicate Calculation Logic**
- `fetchRoleData` (lines 908-1994) duplicates most of `calculateEmployeeMetrics` logic
- Payment plan processing duplicated in 4+ places
- Category resolution duplicated
- Helper functions (`parseNumericAmount`, `buildCurrencyMeta`) duplicated

### 2. **Performance Issues**
- `fetchRoleData` makes multiple sequential async calls (could be parallel)
- Category resolution happens on every lead (should be memoized)
- Payment plans fetched multiple times for same data
- No batching of similar operations
- `fetchRoleData` is called individually for each employee (should use batch)

### 3. **Code Organization**
- ~1000 lines of calculation logic in page component
- Field view calculations mixed with data fetching
- Category resolution tightly coupled to component state

## Refactoring Plan

### Phase 1: Extract Utilities ✅
- ✅ Created `paymentPlanProcessor.ts` for payment processing
- ✅ Created `categoryResolver.ts` for category resolution

### Phase 2: Refactor fetchRoleData
- Replace `fetchRoleData` logic with calls to `calculateEmployeeMetrics`
- Use payment processing utilities
- Use category resolution utilities
- Batch data fetching where possible

### Phase 3: Extract Field View Calculations
- Move field view calculation logic to `salesContributionCalculator.ts`
- Separate data fetching from calculations

### Phase 4: Optimize Performance
- Batch all employee calculations in `handleSearch`
- Memoize category resolution
- Cache payment plan data
- Remove redundant calculations

## Key Functions to Refactor

1. **fetchRoleData** (lines 908-1994) → Should just fetch data and call `calculateEmployeeMetrics`
2. **processFieldViewData** (lines 3897-4806) → Extract calculations to utilities
3. **fetchDueAmounts** (lines 2114-2265) → Use payment processing utilities
4. **Category resolution functions** → Move to `categoryResolver.ts` ✅

## Performance Optimizations Needed

1. **Batch employee calculations** - Already done in `handleSearch`, but `fetchRoleData` still called individually
2. **Cache payment plans** - Don't fetch same payment plans multiple times
3. **Memoize category resolution** - Cache resolved categories
4. **Parallel async calls** - Fetch payment plans in parallel with leads
