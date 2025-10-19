-- Cleanup script for orphaned contact records before adding foreign key constraints
-- This script identifies and handles orphaned records in lead_leadcontact table

-- 1. First, let's see what orphaned records we have
SELECT 
    'Orphaned lead_leadcontact records' as issue_type,
    COUNT(*) as count
FROM public.lead_leadcontact llc
LEFT JOIN public.leads_lead ll ON llc.lead_id = ll.id
WHERE ll.id IS NULL;

-- 2. Show specific orphaned records
SELECT 
    llc.id as relationship_id,
    llc.lead_id,
    llc.contact_id,
    llc.main,
    'Orphaned lead_id - lead does not exist in leads_lead table' as issue
FROM public.lead_leadcontact llc
LEFT JOIN public.leads_lead ll ON llc.lead_id = ll.id
WHERE ll.id IS NULL
ORDER BY llc.lead_id
LIMIT 10;

-- 3. Check for orphaned contact_id references
SELECT 
    'Orphaned contact_id references' as issue_type,
    COUNT(*) as count
FROM public.lead_leadcontact llc
LEFT JOIN public.leads_contact lc ON llc.contact_id = lc.id
WHERE lc.id IS NULL;

-- 4. Show specific orphaned contact_id records
SELECT 
    llc.id as relationship_id,
    llc.lead_id,
    llc.contact_id,
    llc.main,
    'Orphaned contact_id - contact does not exist in leads_contact table' as issue
FROM public.lead_leadcontact llc
LEFT JOIN public.leads_contact lc ON llc.contact_id = lc.id
WHERE lc.id IS NULL
ORDER BY llc.contact_id
LIMIT 10;

-- 5. OPTION A: Delete orphaned records (RECOMMENDED for cleanup)
-- Uncomment the following lines to delete orphaned records:

-- DELETE FROM public.lead_leadcontact 
-- WHERE lead_id IN (
--     SELECT llc.lead_id 
--     FROM public.lead_leadcontact llc
--     LEFT JOIN public.leads_lead ll ON llc.lead_id = ll.id
--     WHERE ll.id IS NULL
-- );

-- DELETE FROM public.lead_leadcontact 
-- WHERE contact_id IN (
--     SELECT llc.contact_id 
--     FROM public.lead_leadcontact llc
--     LEFT JOIN public.leads_contact lc ON llc.contact_id = lc.id
--     WHERE lc.id IS NULL
-- );

-- 6. OPTION B: Archive orphaned records instead of deleting
-- Create a backup table for orphaned records
CREATE TABLE IF NOT EXISTS public.lead_leadcontact_orphaned (
    id BIGINT,
    main TEXT,
    contact_id BIGINT,
    lead_id BIGINT,
    contract_html TEXT,
    signed_contract_html TEXT,
    uid TEXT,
    public_token TEXT,
    archived_at TIMESTAMP DEFAULT NOW()
);

-- Move orphaned records to backup table
INSERT INTO public.lead_leadcontact_orphaned (
    id, main, contact_id, lead_id, contract_html, 
    signed_contract_html, uid, public_token, archived_at
)
SELECT 
    llc.id, llc.main, llc.contact_id, llc.lead_id, llc.contract_html,
    llc.signed_contract_html, llc.uid, llc.public_token, NOW()
FROM public.lead_leadcontact llc
LEFT JOIN public.leads_lead ll ON llc.lead_id = ll.id
LEFT JOIN public.leads_contact lc ON llc.contact_id = lc.id
WHERE ll.id IS NULL OR lc.id IS NULL;

-- Delete orphaned records from main table
DELETE FROM public.lead_leadcontact 
WHERE id IN (
    SELECT id FROM public.lead_leadcontact_orphaned
);

-- 7. Verify cleanup was successful
SELECT 
    'Remaining orphaned records' as status,
    COUNT(*) as count
FROM public.lead_leadcontact llc
LEFT JOIN public.leads_lead ll ON llc.lead_id = ll.id
LEFT JOIN public.leads_contact lc ON llc.contact_id = lc.id
WHERE ll.id IS NULL OR lc.id IS NULL;

-- 8. Now we can safely add the foreign key constraints
-- (This will be done in the improve_contact_tables.sql script)

-- 9. Additional cleanup: Check for duplicate main contacts per lead
SELECT 
    lead_id,
    COUNT(*) as main_contact_count
FROM public.lead_leadcontact 
WHERE main = 'true'
GROUP BY lead_id
HAVING COUNT(*) > 1;

-- 10. Fix duplicate main contacts (keep the first one, mark others as false)
WITH duplicate_mains AS (
    SELECT 
        id,
        ROW_NUMBER() OVER (PARTITION BY lead_id ORDER BY id) as rn
    FROM public.lead_leadcontact 
    WHERE main = 'true'
)
UPDATE public.lead_leadcontact 
SET main = 'false'
WHERE id IN (
    SELECT id FROM duplicate_mains WHERE rn > 1
);

-- 11. Final verification
SELECT 
    'Total lead_leadcontact records' as status,
    COUNT(*) as count
FROM public.lead_leadcontact;

SELECT 
    'Total leads_lead records' as status,
    COUNT(*) as count
FROM public.leads_lead;

SELECT 
    'Total leads_contact records' as status,
    COUNT(*) as count
FROM public.leads_contact;
