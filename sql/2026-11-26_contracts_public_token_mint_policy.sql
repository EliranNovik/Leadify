-- Allow minting the first public_token on a contract (token is currently NULL).
-- The older "Update signed contracts" policy required public_token IS NOT NULL,
-- which silently blocked the first share write (PostgREST returns 0 rows, no error).

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'contracts'
      AND policyname = 'Mint public_token when missing'
  ) THEN
    CREATE POLICY "Mint public_token when missing"
      ON public.contracts
      FOR UPDATE
      USING (public_token IS NULL)
      WITH CHECK (public_token IS NOT NULL);
  END IF;
END $$;
