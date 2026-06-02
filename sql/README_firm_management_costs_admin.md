# Firm management costs (Marketing suppliers admin)

The admin **Marketing → Marketing suppliers** screen uses the existing table `firm_management_costs` (same as External Firms report).

## If the table is missing

Run in Supabase SQL editor (in order):

1. `sql/2026-04-10_firm_management_costs_and_invoices.sql` — creates `firm_management_costs` and `firm_invoices`, RLS, triggers (requires `public.firms` and `public.firms_touch_updated_at()`).

No new tables are required for the admin UI.

## Schema reference

```sql
-- firm_management_costs (already defined in 2026-04-10_firm_management_costs_and_invoices.sql)
-- id uuid PK
-- firm_id uuid NOT NULL → firms(id)
-- billing_month date NOT NULL  -- first day of month (YYYY-MM-01)
-- amount numeric(14,2) NOT NULL
-- currency text NOT NULL DEFAULT 'ILS'
-- notes text
-- created_at, updated_at timestamptz
```
