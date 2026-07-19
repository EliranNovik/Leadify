-- Fix: contract_types not visible to Admin UI (empty dropdown).
-- Run if you already applied 2026-07-19_contract_types.sql without grants/RLS.

ALTER TABLE public.contract_types ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS contract_types_select_authenticated ON public.contract_types;
CREATE POLICY contract_types_select_authenticated
  ON public.contract_types
  FOR SELECT
  TO authenticated
  USING (true);

DROP POLICY IF EXISTS contract_types_select_anon ON public.contract_types;
CREATE POLICY contract_types_select_anon
  ON public.contract_types
  FOR SELECT
  TO anon
  USING (true);

GRANT SELECT ON public.contract_types TO authenticated, anon;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relname = 'contract_types_id_seq'
  ) THEN
    GRANT USAGE, SELECT ON SEQUENCE public.contract_types_id_seq TO authenticated;
  END IF;
END $$;

-- Ensure seed rows exist
INSERT INTO public.contract_types (slug, name, sort_order, active)
VALUES
  ('client_contract', 'Client contract', 10, true),
  ('employee_contract', 'Employee contract', 20, true),
  ('firm_contract', 'Firm contract', 30, true),
  ('other_contract', 'Other contract', 40, true)
ON CONFLICT (slug) DO UPDATE
SET
  name = EXCLUDED.name,
  sort_order = EXCLUDED.sort_order,
  active = EXCLUDED.active;

NOTIFY pgrst, 'reload schema';
