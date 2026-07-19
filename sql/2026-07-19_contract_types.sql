-- Contract types (client / employee / firm / other) + link to templates & contracts.
-- Also adds employee_id on contracts for HR employee digital contracts.

CREATE TABLE IF NOT EXISTS public.contract_types (
  id BIGSERIAL PRIMARY KEY,
  slug TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0,
  active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

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

-- contract_templates.contract_type_id
ALTER TABLE public.contract_templates
  ADD COLUMN IF NOT EXISTS contract_type_id BIGINT;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'contract_templates_contract_type_id_fkey'
  ) THEN
    ALTER TABLE public.contract_templates
      ADD CONSTRAINT contract_templates_contract_type_id_fkey
      FOREIGN KEY (contract_type_id)
      REFERENCES public.contract_types(id)
      ON DELETE SET NULL;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_contract_templates_contract_type_id
  ON public.contract_templates(contract_type_id);

-- misc_contracttemplate.contract_type_id (legacy templates)
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'misc_contracttemplate'
  ) THEN
    ALTER TABLE public.misc_contracttemplate
      ADD COLUMN IF NOT EXISTS contract_type_id BIGINT;

    IF NOT EXISTS (
      SELECT 1
      FROM pg_constraint
      WHERE conname = 'misc_contracttemplate_contract_type_id_fkey'
    ) THEN
      ALTER TABLE public.misc_contracttemplate
        ADD CONSTRAINT misc_contracttemplate_contract_type_id_fkey
        FOREIGN KEY (contract_type_id)
        REFERENCES public.contract_types(id)
        ON DELETE SET NULL;
    END IF;

    CREATE INDEX IF NOT EXISTS idx_misc_contracttemplate_contract_type_id
      ON public.misc_contracttemplate(contract_type_id);
  END IF;
END $$;

-- contracts.contract_type_id + employee_id
ALTER TABLE public.contracts
  ADD COLUMN IF NOT EXISTS contract_type_id BIGINT;

ALTER TABLE public.contracts
  ADD COLUMN IF NOT EXISTS employee_id INTEGER;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'contracts_contract_type_id_fkey'
  ) THEN
    ALTER TABLE public.contracts
      ADD CONSTRAINT contracts_contract_type_id_fkey
      FOREIGN KEY (contract_type_id)
      REFERENCES public.contract_types(id)
      ON DELETE SET NULL;
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'contracts_employee_id_fkey'
  ) THEN
    ALTER TABLE public.contracts
      ADD CONSTRAINT contracts_employee_id_fkey
      FOREIGN KEY (employee_id)
      REFERENCES public.tenants_employee(id)
      ON DELETE SET NULL;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_contracts_contract_type_id
  ON public.contracts(contract_type_id);

CREATE INDEX IF NOT EXISTS idx_contracts_employee_id
  ON public.contracts(employee_id);

-- Backfill existing rows to client contract
UPDATE public.contract_templates
SET contract_type_id = (
  SELECT id FROM public.contract_types WHERE slug = 'client_contract' LIMIT 1
)
WHERE contract_type_id IS NULL;

UPDATE public.contracts
SET contract_type_id = (
  SELECT id FROM public.contract_types WHERE slug = 'client_contract' LIMIT 1
)
WHERE contract_type_id IS NULL;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'misc_contracttemplate'
  ) THEN
    UPDATE public.misc_contracttemplate
    SET contract_type_id = (
      SELECT id FROM public.contract_types WHERE slug = 'client_contract' LIMIT 1
    )
    WHERE contract_type_id IS NULL;
  END IF;
END $$;

COMMENT ON TABLE public.contract_types IS
  'Lookup for digital contract kinds: client, employee, firm, other.';
COMMENT ON COLUMN public.contracts.employee_id IS
  'HR employee digital contracts; null for client contracts.';
COMMENT ON COLUMN public.contracts.contract_type_id IS
  'FK to contract_types; existing rows default to client_contract.';

-- Access for app role (required for Admin / HR to load the dropdown)
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
GRANT USAGE, SELECT ON SEQUENCE public.contract_types_id_seq TO authenticated;