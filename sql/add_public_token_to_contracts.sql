-- Add public_token column to contracts table for sharing new contracts
ALTER TABLE public.contracts 
ADD COLUMN IF NOT EXISTS public_token TEXT;

-- Add index for faster lookups by public_token
CREATE INDEX IF NOT EXISTS idx_contracts_public_token 
ON public.contracts(public_token);

-- Add RLS policy for public access to contracts with valid token
DO $$ 
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_policies 
        WHERE tablename = 'contracts' 
        AND policyname = 'Public access to contracts with valid token'
    ) THEN
        CREATE POLICY "Public access to contracts with valid token" 
        ON public.contracts 
        FOR SELECT 
        USING (public_token IS NOT NULL);
    END IF;
END $$;

-- Add RLS policy for updating signed contracts
DO $$ 
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_policies 
        WHERE tablename = 'contracts' 
        AND policyname = 'Update signed contracts'
    ) THEN
        CREATE POLICY "Update signed contracts" 
        ON public.contracts 
        FOR UPDATE 
        USING (public_token IS NOT NULL);
    END IF;
END $$;
