-- Add the "Dropped (Spam/Irrelevant)" stage to the lead_stages table
-- This maps the stage name to the same ID as "Unactivated" for consistency
INSERT INTO public.lead_stages (id, name) 
VALUES ('dropped_spam_irrelevant', 'Dropped (Spam/Irrelevant)')
ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name;

-- Also ensure the "unactivate_spam" stage exists
INSERT INTO public.lead_stages (id, name) 
VALUES ('unactivate_spam', 'Unactivate/Spam')
ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name;

-- Enable RLS (Row Level Security) on the lead_stages table if not already enabled
ALTER TABLE public.lead_stages ENABLE ROW LEVEL SECURITY;

-- Create policy to allow authenticated users to read stage data if not already exists
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_policies 
        WHERE tablename = 'lead_stages' 
        AND policyname = 'Allow authenticated users to read lead_stages'
    ) THEN
        CREATE POLICY "Allow authenticated users to read lead_stages" ON public.lead_stages
            FOR SELECT
            TO authenticated
            USING (true);
    END IF;
END $$;
