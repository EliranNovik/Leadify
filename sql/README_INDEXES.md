# Database indexes for performance

This folder contains SQL scripts that add indexes used by the app. The main ones for **Clients**, **ClientHeader**, **Header search bar**, and **legacyLeadsApi** are:

- **`indexes_for_search_and_clients.sql`** – lead/contact search and list (run this first if search or client list is slow)
- **`indexes_tenants_employee_and_users.sql`** – tenants_employee (display_name, user_id) and users (employee_id) for profile/display lookups and joins (ClientHeader, Clients, etc.)
- **`indexes_clients_clientheader_interactions.sql`** – indexes for Clients, ClientHeader, and InteractionsTab (users, meetings, emails, whatsapp_messages, call_logs, leads_leadinteractions, misc_* tables)
- **`simple_search_indexes.sql`** – basic search indexes (lead_number, name, email, phone)
- **`optimize_pipeline_performance.sql`** – pipeline page (created_at, cdate, stage, closer, etc.)
- **`optimize_junction_table_indexes.sql`** – `lead_leadcontact` junction
- **`optimize_contact_search_indexes.sql`** – `leads_contact` search (name, email, phone, newlead_id)

## How to check indexes in the database

Use **Supabase Dashboard → SQL Editor** (or any PostgreSQL client).

### 1. List indexes for leads/contacts tables

```sql
SELECT schemaname, tablename, indexname, indexdef
FROM pg_indexes
WHERE tablename IN ('leads', 'leads_lead', 'leads_contact', 'lead_leadcontact')
ORDER BY tablename, indexname;
```

### 2. Check if a specific index exists

```sql
SELECT indexname, indexdef
FROM pg_indexes
WHERE tablename = 'leads' AND indexname LIKE 'idx_leads%';
```

### 3. See if a query uses an index (EXPLAIN)

Run your query with `EXPLAIN (ANALYZE, BUFFERS)` to see the plan:

```sql
EXPLAIN (ANALYZE, BUFFERS, FORMAT TEXT)
SELECT id, lead_number, name, email FROM leads
WHERE lead_number ILIKE '12345%' LIMIT 25;
```

- **Index Scan** / **Index Only Scan** = index is used (good).
- **Seq Scan** = full table scan (consider adding an index if the table is large).

### 4. Table and index sizes

```sql
SELECT
  relname AS table_name,
  pg_size_pretty(pg_total_relation_size(relid)) AS total_size,
  pg_size_pretty(pg_relation_size(relid)) AS table_size,
  pg_size_pretty(pg_total_relation_size(relid) - pg_relation_size(relid)) AS indexes_size
FROM pg_catalog.pg_statio_user_tables
WHERE relname IN ('leads', 'leads_lead', 'leads_contact', 'lead_leadcontact')
ORDER BY pg_total_relation_size(relid) DESC;
```

## Applying the indexes

1. Open **Supabase Dashboard** → your project → **SQL Editor**.
2. Paste the contents of `indexes_for_search_and_clients.sql` (and any other script you need).
3. Run the script. All statements use `IF NOT EXISTS`, so it’s safe to run more than once.

After adding indexes, run the “List indexes” query above to confirm they exist, and use EXPLAIN on a slow query to confirm the index is used.
