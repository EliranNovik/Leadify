# Firm management costs (Marketing suppliers admin)

The admin **Marketing → Marketing suppliers** screen uses the existing table `firm_management_costs` (same as External Firms report).

## If the table is missing

Run in Supabase SQL editor (in order):

1. `sql/2026-04-10_firm_management_costs_and_invoices.sql` — creates `firm_management_costs` and `firm_invoices`, RLS, triggers (requires `public.firms` and `public.firms_touch_updated_at()`).
2. `sql/firm_management_costs_add_payment_tax_docs.sql` — adds `payment_confirmation` and `tax_receipt` columns.
3. `sql/create_firm_management_cost_document_buckets.sql` — Storage buckets for those documents (run after step 2).
4. `sql/create_expense_types_table.sql` — `expense_types` lookup + `expense_type_id` FK on `firm_management_costs`.

Invoice files still use `firm_invoices` + `firm-invoice-documents` bucket (`sql/create_firm_invoice_documents_bucket.sql`).

## Schema reference

```sql
-- firm_management_costs (already defined in 2026-04-10_firm_management_costs_and_invoices.sql)
-- id uuid PK
-- firm_id uuid NOT NULL → firms(id)
-- billing_month date NOT NULL  -- first day of month (YYYY-MM-01)
-- amount numeric(14,2) NOT NULL
-- currency text NOT NULL DEFAULT 'ILS'
-- notes text
-- payment_confirmation text  -- path in firm-management-payment-confirmations bucket
-- tax_receipt text             -- path in firm-management-tax-receipts bucket
-- expense_type_id uuid         -- FK → expense_types
-- created_at, updated_at timestamptz
```
