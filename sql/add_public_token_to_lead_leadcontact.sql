-- Add public_token column to lead_leadcontact table for sharing legacy contracts
ALTER TABLE public.lead_leadcontact 
ADD COLUMN IF NOT EXISTS public_token text;

-- Add index for faster lookups by public_token
CREATE INDEX IF NOT EXISTS idx_lead_leadcontact_public_token 
ON public.lead_leadcontact(public_token);

-- Add RLS policy for public access to contracts with valid token
DO $$ 
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_policies 
        WHERE tablename = 'lead_leadcontact' 
        AND policyname = 'Public access to legacy contracts with valid token'
    ) THEN
        CREATE POLICY "Public access to legacy contracts with valid token" 
        ON public.lead_leadcontact 
        FOR SELECT 
        USING (public_token IS NOT NULL);
    END IF;
END $$;

-- Add RLS policy for updating signed contracts
DO $$ 
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_policies 
        WHERE tablename = 'lead_leadcontact' 
        AND policyname = 'Update signed legacy contracts'
    ) THEN
        CREATE POLICY "Update signed legacy contracts" 
        ON public.lead_leadcontact 
        FOR UPDATE 
        USING (public_token IS NOT NULL);
    END IF;
END $$;
