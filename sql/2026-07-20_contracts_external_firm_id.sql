-- External firm digital contracts (TipTap) — links contracts to firms table.
-- Run after sql/2026-07-19_contract_types.sql.

ALTER TABLE public.contracts
  ADD COLUMN IF NOT EXISTS external_firm_id UUID;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'contracts_external_firm_id_fkey'
  ) THEN
    ALTER TABLE public.contracts
      ADD CONSTRAINT contracts_external_firm_id_fkey
      FOREIGN KEY (external_firm_id)
      REFERENCES public.firms(id)
      ON DELETE SET NULL;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_contracts_external_firm_id
  ON public.contracts(external_firm_id);

COMMENT ON COLUMN public.contracts.external_firm_id IS
  'External firm digital contracts; null for client / employee contracts.';

NOTIFY pgrst, 'reload schema';
