-- Simple script to enable CASCADE DELETE for leads_contact table
-- This directly updates the foreign key constraints without loops to avoid throttling

BEGIN;

-- ============================================
-- Update emails table foreign key
-- ============================================
-- First, check what constraints exist on emails table referencing leads_contact
-- Then update them directly

ALTER TABLE public.emails 
DROP CONSTRAINT IF EXISTS emails_contact_id_fkey;

ALTER TABLE public.emails 
ADD CONSTRAINT emails_contact_id_fkey 
FOREIGN KEY (contact_id) 
REFERENCES public.leads_contact(id) 
ON DELETE CASCADE;

-- If there's a different constraint name, try common variations
ALTER TABLE public.emails 
DROP CONSTRAINT IF EXISTS fk_emails_contact_id;

ALTER TABLE public.emails 
DROP CONSTRAINT IF EXISTS emails_contact_id_leads_contact_id_fk;

-- ============================================
-- Update lead_leadcontact table foreign key
-- ============================================
ALTER TABLE public.lead_leadcontact 
DROP CONSTRAINT IF EXISTS lead_leadcontact_contact_id_fkey;

ALTER TABLE public.lead_leadcontact 
ADD CONSTRAINT lead_leadcontact_contact_id_fkey 
FOREIGN KEY (contact_id) 
REFERENCES public.leads_contact(id) 
ON DELETE CASCADE;

-- Drop any alternative constraint names
ALTER TABLE public.lead_leadcontact 
DROP CONSTRAINT IF EXISTS fk_lead_leadcontact_contact_id;

-- ============================================
-- Update whatsapp_messages table (if it references leads_contact)
-- ============================================
ALTER TABLE public.whatsapp_messages 
DROP CONSTRAINT IF EXISTS whatsapp_messages_contact_id_fkey;

-- Only add if the column exists (optional - won't error if column doesn't exist)
DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'whatsapp_messages' 
        AND column_name = 'contact_id'
        AND table_schema = 'public'
    ) THEN
        EXECUTE 'ALTER TABLE public.whatsapp_messages 
                 ADD CONSTRAINT whatsapp_messages_contact_id_fkey 
                 FOREIGN KEY (contact_id) 
                 REFERENCES public.leads_contact(id) 
                 ON DELETE CASCADE';
    END IF;
END $$;

-- ============================================
-- Verify the constraints
-- ============================================
SELECT
    tc.table_name,
    kcu.column_name,
    tc.constraint_name,
    rc.delete_rule,
    CASE WHEN rc.delete_rule = 'CASCADE' THEN '✓' ELSE '✗' END as status
FROM 
    information_schema.table_constraints AS tc
    JOIN information_schema.key_column_usage AS kcu
      ON tc.constraint_name = kcu.constraint_name
    JOIN information_schema.referential_constraints AS rc
      ON tc.constraint_name = rc.constraint_name
    JOIN information_schema.constraint_column_usage AS ccu
      ON ccu.constraint_name = tc.constraint_name
WHERE 
    tc.constraint_type = 'FOREIGN KEY'
    AND ccu.table_name = 'leads_contact'
    AND tc.table_schema = 'public'
ORDER BY tc.table_name, kcu.column_name;

COMMIT;

-- ============================================
-- After running this script:
-- ============================================
-- You should now be able to run:
-- TRUNCATE TABLE leads_contact CASCADE;
--
-- OR
--
-- DELETE FROM leads_contact;

