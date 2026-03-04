# Next queries to improve (priority order)

You’ve already fixed **leads.lead_number** ILIKE. Below are the next high‑impact targets, in order.

---

## 1. Legacy lead number search (leads_lead) — **do this next**

**Where it’s used:** Header search and legacyLeadsApi when searching by lead number (e.g. "11234" or "L11234"). The app runs:

- `leads_lead` with `lead_number ILIKE '12345%'` (prefix)
- `leads_lead` with `lead_number = '12345'` / `= 'L12345'` (exact)

**Risk:** Without a `text_pattern_ops` index on `leads_lead.lead_number`, that table can do a Seq Scan (same issue you had on `leads`).

**Note:** In many schemas `leads_lead.lead_number` is **bigint**, so we use an expression index on `(lead_number::text)` and avoid `<> ''` in the WHERE (invalid for bigint).

**Add the index (if not already present):**

```sql
CREATE INDEX IF NOT EXISTS idx_leads_lead_lead_number_pattern
  ON public.leads_lead ((lead_number::text) text_pattern_ops)
  WHERE lead_number IS NOT NULL;
```

**Check that it’s used:**  
If `lead_number` is bigint, the query must cast to text so the index is used:

```sql
EXPLAIN (ANALYZE, BUFFERS, FORMAT TEXT)
SELECT id, name, email, phone, mobile, topic, stage, cdate, master_id, status, lead_number
FROM leads_lead
WHERE lead_number::text ILIKE '11234%'
LIMIT 20;
```

You want to see: **Index Scan using idx_leads_lead_lead_number_pattern on leads_lead**. If you see **Seq Scan**, the index is missing or not being chosen (run `ANALYZE leads_lead;` and try again).

---

## 2. Contact search (leads_contact) — email and name

**Where it’s used:** Header search by email or name. The app runs:

- `leads_contact` with `email ILIKE 'user@example%'` (prefix)
- `leads_contact` with `name ILIKE '%john%'` (contains) or `name ILIKE 'john%'` (prefix)

**Risk:** Prefix searches can use a `text_pattern_ops` index. Contains (`%x%`) often still does a scan; the main win here is **email/name prefix**.

**Add indexes (if not already present):**

```sql
-- Email prefix (e.g. "user@example")
CREATE INDEX IF NOT EXISTS idx_leads_contact_email_pattern
  ON public.leads_contact (email text_pattern_ops)
  WHERE email IS NOT NULL AND email <> '';

-- Name prefix (e.g. "John")
CREATE INDEX IF NOT EXISTS idx_leads_contact_name_pattern
  ON public.leads_contact (name text_pattern_ops)
  WHERE name IS NOT NULL AND name <> '';
```

**Check email prefix:**

```sql
EXPLAIN (ANALYZE, BUFFERS, FORMAT TEXT)
SELECT id, name, email, phone, mobile, newlead_id
FROM leads_contact
WHERE email ILIKE 'test%'
LIMIT 30;
```

**Check name prefix:**

```sql
EXPLAIN (ANALYZE, BUFFERS, FORMAT TEXT)
SELECT id, name, email, phone, mobile, newlead_id
FROM leads_contact
WHERE name ILIKE 'john%'
LIMIT 30;
```

You want **Index Scan** on the corresponding pattern index. For `name ILIKE '%john%'`, a Seq Scan may still be used; that’s expected unless you add a GIN trigram index later.

---

## 3. Junction table (lead_leadcontact)

**Where it’s used:** When resolving contacts for a lead (e.g. “which contacts belong to lead X?”). Queries use:

- `WHERE newlead_id IN (...)` 
- `WHERE lead_id IN (...)` 
- `WHERE contact_id IN (...)`

You already have indexes such as `idx_lead_leadcontact_contact_id`, `idx_lead_leadcontact_lead_id`, and `idx_lead_leadcontact_newlead_main`. So this is **lower priority**. If you still see slow search when opening a lead, run:

```sql
EXPLAIN (ANALYZE, BUFFERS, FORMAT TEXT)
SELECT contact_id, newlead_id, lead_id, main
FROM lead_leadcontact
WHERE newlead_id IN ('uuid-1', 'uuid-2')
LIMIT 150;
```

Replace the UUIDs with real values from your DB. You want **Index Scan** on one of the junction indexes, not Seq Scan.

---

## 4. Clients page: duplicate contacts query

**Where it’s used:** Clients.tsx when checking for duplicate contacts (email/name/phone). It does one big `leads_contact` query with an `.or()` of many conditions.

**Check whether it’s expensive:**

Run something like (adjust the filter values to match real data):

```sql
EXPLAIN (ANALYZE, BUFFERS, FORMAT TEXT)
SELECT id, name, email, phone, mobile, country_id
FROM leads_contact
WHERE email = 'someone@example.com'
   OR name ILIKE '%someone%'
   OR phone = '+972501234567'
   OR mobile = '+972501234567'
LIMIT 50;
```

If this shows **Seq Scan** and a high execution time (e.g. > 10 ms) and the table is large, we can add or adjust indexes (e.g. keep email/phone equality indexes and consider trigram for name contains). If it’s already fast or the table is small, leave it as is.

---

## 5. Optional: fetchLatestLead / fetchAllLeads

**Where it’s used:** Clients.tsx when opening the app or switching to “latest” lead. Queries:

- `leads` ordered by `created_at DESC` limit 1 or 100
- `leads_lead` ordered by `cdate DESC` limit 1 or 100

You already have `idx_leads_created_at` and `idx_leads_lead_cdate`. These are usually efficient. If the Clients page is slow on first load, run:

```sql
EXPLAIN (ANALYZE, BUFFERS, FORMAT TEXT)
SELECT id, lead_number, name, email, phone, mobile, topic, stage, created_at, status
FROM leads
ORDER BY created_at DESC
LIMIT 100;
```

You want **Index Scan** (or Index Only Scan) using the `created_at` index, not a full table Seq Scan.

---

## Summary: what to do next

| Priority | Target                    | Action |
|----------|---------------------------|--------|
| **1**    | leads_lead.lead_number    | Add `idx_leads_lead_lead_number_pattern` (text_pattern_ops), then EXPLAIN the ILIKE query above. |
| **2**    | leads_contact email/name  | Add `idx_leads_contact_email_pattern` and `idx_leads_contact_name_pattern`, then EXPLAIN email and name prefix queries. |
| **3**    | lead_leadcontact          | Only if search-by-lead is still slow: EXPLAIN the junction query with real `newlead_id`/`lead_id`. |
| **4**    | Clients duplicate check   | EXPLAIN the `leads_contact` OR query; add/change indexes only if it’s slow and the table is large. |
| **5**    | fetchLatestLead/fetchAllLeads | Only if first load is slow: EXPLAIN the `ORDER BY created_at DESC LIMIT 100` query. |

You can run the full set of index definitions from **`sql/indexes_for_search_and_clients.sql`** in one go (it uses `IF NOT EXISTS`). That will create any of the above indexes that are still missing. Then re-run the relevant EXPLAINs to confirm they’re used.
