-- Fix the lead_leadcontact table to have proper ID generation
-- The current table has 'id bigint not null' but no sequence/identity

-- First, let's check if there's already a sequence
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_sequences WHERE schemaname = 'public' AND sequencename = 'lead_leadcontact_id_seq') THEN
        -- Create a sequence for the ID
        CREATE SEQUENCE public.lead_leadcontact_id_seq
            START WITH 1
            INCREMENT BY 1
            NO MINVALUE
            NO MAXVALUE
            CACHE 1;
    END IF;
END $$;

-- Alter the table to use the sequence for ID generation
ALTER TABLE public.lead_leadcontact ALTER COLUMN id SET DEFAULT nextval('public.lead_leadcontact_id_seq'::regclass);

-- Set the sequence to start from the maximum ID + 1 if there are existing records
SELECT setval('public.lead_leadcontact_id_seq', COALESCE((SELECT MAX(id) FROM public.lead_leadcontact), 0) + 1, false);
