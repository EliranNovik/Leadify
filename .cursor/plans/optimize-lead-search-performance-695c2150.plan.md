<!-- 695c2150-fc15-48a8-ba38-4f82ba3dc4f1 5dc2eb44-f829-47a0-a72d-86680cbea6a7 -->
# Optimize Lead Search Performance

## Problem Analysis

The current search implementation is slow because it:

- Makes multiple sequential queries (leads → contacts → relationships → lead details)
- Processes large result sets in JavaScript
- Uses complex OR conditions with many ILIKE patterns
- Lacks proper indexes for phone/email searches on new leads table
- For legacy leads, searches `id` column (which is the lead_number) separately from name/phone/email

## Solution Overview

Create a single PostgreSQL function that performs unified search across all tables, with proper indexes, returning exactly 10 results prioritized by match quality.

## Implementation Steps

### 1. Database: Add Missing Indexes

**File: `sql/optimize_search_indexes.sql`**

Create indexes on `leads` table (new leads) for fast searches:

- Index on `lead_number` (exact matches, prefix matches)
- Index on `lower(name)` for case-insensitive name searches
- Index on `lower(email)` for case-insensitive email searches  
- Indexes on `phone` and `mobile` (with WHERE NOT NULL)
- Composite index on `(lead_number, name)` for combined searches

Note: `leads_lead` already has many indexes, but ensure phone/email indexes exist.

**File: `sql/optimize_contact_search_indexes.sql`**

Optimize `leads_contact` table:

- Index on `lower(name)` (case-insensitive name search)
- Index on `lower(email)` (case-insensitive email search)
- Indexes on `phone` and `mobile` (with WHERE NOT NULL)
- Index on `newlead_id` for faster joins

**File: `sql/optimize_junction_table_indexes.sql`**

Optimize `lead_leadcontact` junction table:

- Composite index on `(contact_id, lead_id, newlead_id)` for fast relationship lookups
- Index on `(lead_id, main)` for filtering main contacts
- Index on `(newlead_id, main)` for filtering main contacts

### 2. Database: Create Unified Search Function

**File: `sql/create_unified_search_function.sql`**

Create PostgreSQL function `search_leads_unified(query_text TEXT, max_results INT DEFAULT 10)` that:

1. **Normalizes input**: Extracts digits, handles email patterns, detects phone numbers
2. **Searches in parallel**:

   - New leads (`leads` table) by: lead_number, name, email, phone, mobile
   - Legacy leads (`leads_lead` table) by: id (lead_number), name, email, phone, mobile
   - Contacts (`leads_contact` table) by: name, email, phone, mobile

3. **Joins relationships**: Uses `lead_leadcontact` to link contacts to their leads
4. **Prioritizes results**: Exact matches first, then prefix matches, then contains matches
5. **Returns unified format**: Single result set with columns indicating source (new/legacy, lead/contact)

**Key implementation details:**

- Use UNION ALL to combine results from different sources
- For legacy leads: search `id` column directly (since id = lead_number)
- Use CTEs (Common Table Expressions) for cleaner code
- Limit results early using LIMIT in subqueries
- Sort by relevance (exact match score) before final LIMIT

### 3. Frontend: Simplify Search Logic

**File: `src/lib/legacyLeadsApi.ts`**

Replace complex `searchLeads()` function with simplified version:

1. **Remove**: All the complex query building, multiple promises, contact relationship fetching
2. **Add**: Simple RPC call to `search_leads_unified` function
3. **Keep**: Result caching logic (30 second cache)
4. **Keep**: Incremental filtering for progressive searches
5. **Remove**: All the console.log debugging statements

**New function signature:**

```typescript
export async function searchLeads(query: string): Promise<CombinedLead[]>
```

**Implementation:**

- Call `supabase.rpc('search_leads_unified', { query_text: trimmedQuery, max_results: 10 })`
- Map database results to `CombinedLead[]` format
- Apply client-side caching
- Return results

**File: `src/components/Header.tsx`**

No changes needed - it already calls `searchLeads()` correctly. The simplification will make it faster automatically.

### 4. Database: Add Phone Number Normalization (Optional Enhancement)

**File: `sql/add_phone_normalization_function.sql`**

Create helper function `normalize_phone(phone_text TEXT)` that:

- Removes all non-digit characters
- Extracts last 5-10 digits for matching
- Handles country codes (+972, etc.)

Use this in search function for better phone number matching.

### 5. Testing & Validation

**File: `sql/test_search_function.sql`**

Create test queries to validate:

- Exact lead number matches (new and legacy)
- Name searches (exact, prefix, contains)
- Email searches
- Phone number searches (full number, last 5 digits)
- Contact searches that link to leads
- Result prioritization (exact matches first)
- Performance (should return in <100ms for most queries)

## Technical Notes

**For legacy leads (`leads_lead` table):**

- The `id` column IS the lead_number (user confirmed)
- Search `id` directly for numeric queries
- `lead_number` column may also exist but `id` is the source of truth

**Result Format:**

The unified function should return a result set with columns:

- `id` (with 'legacy_' prefix for legacy leads)
- `lead_number`
- `name` (contact name if matched via contact, otherwise lead name)
- `email`, `phone`, `mobile`
- `topic`, `stage`
- `lead_type` ('new' or 'legacy')
- `is_contact` (boolean)
- `contact_name` (if matched via contact)
- `is_main_contact` (boolean)
- `created_at`
- `match_score` (for sorting - exact=3, prefix=2, contains=1)

**Performance Targets:**

- Search function executes in <100ms for most queries
- Frontend receives results in <200ms total
- Returns exactly 10 results (or fewer if not enough matches)
- No sequential queries - all done in one database round-trip

### To-dos

- [ ] Populate meetingFormData.manager, helper, and expert from selectedClient when schedule meeting drawer opens (convert IDs to display names)
- [ ] Ensure all three (manager, helper, expert) are saved as display names to meetings table, not IDs
- [ ] Create SQL file with indexes for leads, leads_contact, and lead_leadcontact tables optimized for search queries
- [ ] Create PostgreSQL function search_leads_unified() that performs unified search across all tables in a single query
- [ ] Replace complex searchLeads() function in legacyLeadsApi.ts with simple RPC call to unified search function
- [ ] Create phone number normalization helper function for better phone matching (optional enhancement)
- [ ] Test search function with various query types and validate performance targets (<100ms execution time)