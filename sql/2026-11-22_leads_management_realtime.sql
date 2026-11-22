-- Live updates for Leads management and the employee lead page.
-- Run in the Supabase SQL editor. Adds the tables to the realtime publication
-- and keeps deleted allocation rows complete enough to know which lead changed.

DO $$
DECLARE
  table_name text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY[
    'employee_daily_lead_allocations',
    'employee_daily_lead_allocation_items',
    'employee_clock_in',
    'leads',
    'leads_lead',
    'payment_plans',
    'finances_paymentplanrow',
    'lead_expenses',
    'lead_employee_budget_extension_requests',
    'lead_employee_cost_max_overrides'
  ]
  LOOP
    IF NOT EXISTS (
      SELECT 1 FROM pg_publication_tables
      WHERE pubname = 'supabase_realtime'
        AND schemaname = 'public'
        AND tablename = table_name
    ) THEN
      EXECUTE format('ALTER PUBLICATION supabase_realtime ADD TABLE public.%I', table_name);
    END IF;
  END LOOP;
END $$;

ALTER TABLE public.employee_daily_lead_allocations REPLICA IDENTITY FULL;
ALTER TABLE public.employee_daily_lead_allocation_items REPLICA IDENTITY FULL;
ALTER TABLE public.employee_clock_in REPLICA IDENTITY FULL;
