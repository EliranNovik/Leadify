# How to fix and verify indexes (Seq Scan → Index Scan)

## What you saw

Your `EXPLAIN` showed a **Seq Scan** on `leads` for:

```sql
Filter: (lead_number ~~* '12345%'::text)
Rows Removed by Filter: 3766
```

So the query `WHERE lead_number ILIKE '12345%'` scanned 3766 rows. Your existing indexes (`idx_leads_lead_number`, `idx_leads_lead_number_lower`) are **not** used for `ILIKE`, because in PostgreSQL a plain btree does not support case-insensitive prefix matches. You need an index with **text_pattern_ops** so that `ILIKE 'prefix%'` can use the index.

---

## Step 1: Add the index (Supabase SQL Editor)

Run the script:

**`sql/fix_leads_ilike_lead_number_index.sql`**

It creates:

- `idx_leads_lead_number_pattern` on `leads (lead_number text_pattern_ops)` ← fixes your lead number search
- Optional: same style for `email` and `name` (for Header search by email/name)

Copy the contents of that file into the SQL Editor and execute.

---

## Step 2: Verify the query uses the index

Run the same query again with EXPLAIN:

```sql
EXPLAIN (ANALYZE, BUFFERS, FORMAT TEXT)
SELECT id, lead_number, name, email
FROM leads
WHERE lead_number ILIKE '12345%'
LIMIT 25;
```

**Before (Seq Scan):**

- You see: `Seq Scan on leads` and `Rows Removed by Filter: 3766`

**After (index in use):**

- You should see: **`Index Scan using idx_leads_lead_number_pattern on leads`** (or similar), and no “Rows Removed by Filter” for a full table scan.

Execution time should drop (often to well under 1 ms once the index is used).

---

## Step 3 (optional): Broader search/index coverage

For full coverage of Header search, Clients, and legacy lead search, run:

**`sql/indexes_for_search_and_clients.sql`**

It adds the same kind of indexes for:

- `leads_lead.lead_number` (ILIKE prefix)
- `leads_contact` email/name (search)
- `lead_leadcontact` (junction by `newlead_id` / `lead_id` / `contact_id`)

Your existing index list already has many of these (e.g. junction, `leads_lead_master_id`, etc.); the script uses `IF NOT EXISTS`, so it only adds what’s missing.

---

## Quick reference: index vs query

| Query pattern              | Index type that helps        | Your current indexes                         | Action                          |
|---------------------------|-----------------------------|----------------------------------------------|---------------------------------|
| `lead_number ILIKE 'x%'`  | `(lead_number text_pattern_ops)` | btree on `lead_number` / `lower(lead_number)` only | Add `idx_leads_lead_number_pattern` (Step 1) |
| `email ILIKE 'x%'`        | `(email text_pattern_ops)`   | `lower(email)` only                          | Add `idx_leads_email_pattern` (same script) |
| `name ILIKE 'x%'`         | `(name text_pattern_ops)`   | `lower(name)` only                           | Add `idx_leads_name_pattern` (same script) |

---

## If it still does a Seq Scan

1. **Statistics:** Run `ANALYZE leads;` so the planner has up-to-date stats.
2. **Check the index exists:**
   ```sql
   SELECT indexname, indexdef
   FROM pg_indexes
   WHERE tablename = 'leads' AND indexname = 'idx_leads_lead_number_pattern';
   ```
3. **Force (for testing only):** Temporarily disable sequential scan to see if the planner then picks the index:
   ```sql
   SET enable_seqscan = off;
   EXPLAIN (ANALYZE) SELECT ... WHERE lead_number ILIKE '12345%' LIMIT 25;
   SET enable_seqscan = on;
   ```
   If with `enable_seqscan = off` you get an Index Scan, the index is usable and the planner may have preferred Seq Scan due to small table size or outdated stats; run `ANALYZE leads;` and re-check.
