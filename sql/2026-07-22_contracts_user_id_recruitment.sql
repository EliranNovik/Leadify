-- Recruitment digital contracts: link contracts to CRM users (no employee_id).
-- Reuses employee_contract templates/type for hiring paperwork.

ALTER TABLE public.contracts
  ADD COLUMN IF NOT EXISTS user_id UUID;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'contracts_user_id_fkey'
  ) THEN
    ALTER TABLE public.contracts
      ADD CONSTRAINT contracts_user_id_fkey
      FOREIGN KEY (user_id)
      REFERENCES public.users(id)
      ON DELETE SET NULL;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_contracts_user_id
  ON public.contracts(user_id)
  WHERE user_id IS NOT NULL;

COMMENT ON COLUMN public.contracts.user_id IS
  'CRM user owner for recruitment / non-employee digital contracts (users without employee_id).';
