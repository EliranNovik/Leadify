-- Simple and robust fix for main column values in lead_leadcontact table
-- This script handles all possible data type issues safely

-- 1. First, let's see what values exist in the main column
SELECT 
    'Current main column values' as info,
    COALESCE(main::text, 'NULL') as value,
    COUNT(*) as count
FROM public.lead_leadcontact 
GROUP BY main
ORDER BY count DESC;

-- 2. Show specific records with potentially invalid main values
SELECT 
    id,
    lead_id,
    contact_id,
    main::text as current_value,
    CASE 
        WHEN main IN ('true', 'false') THEN 'Valid'
        WHEN main IS NULL THEN 'NULL (valid)'
        ELSE 'Invalid'
    END as status
FROM public.lead_leadcontact 
WHERE main NOT IN ('true', 'false') OR main IS NULL
ORDER BY id
LIMIT 20;

-- 3. Fix invalid values step by step
-- Convert common positive values to 'true'
UPDATE public.lead_leadcontact 
SET main = 'true'
WHERE main::text IN ('1', 'yes', 'y', 't', 'true', 'main', 'primary');

-- Convert common negative values to 'false'  
UPDATE public.lead_leadcontact 
SET main = 'false'
WHERE main::text IN ('0', 'no', 'n', 'f', 'false', 'secondary', 'additional');

-- Convert any remaining non-standard positive values to 'true'
UPDATE public.lead_leadcontact 
SET main = 'true'
WHERE main::text NOT IN ('true', 'false') 
AND main IS NOT NULL
AND (
    LOWER(main::text) LIKE '%true%' OR
    LOWER(main::text) LIKE '%yes%' OR
    LOWER(main::text) LIKE '%main%' OR
    LOWER(main::text) LIKE '%primary%' OR
    main::text IN ('1', 't', 'y')
);

-- Convert any remaining non-standard negative values to 'false'
UPDATE public.lead_leadcontact 
SET main = 'false'
WHERE main::text NOT IN ('true', 'false') 
AND main IS NOT NULL
AND (
    LOWER(main::text) LIKE '%false%' OR
    LOWER(main::text) LIKE '%no%' OR
    LOWER(main::text) LIKE '%secondary%' OR
    LOWER(main::text) LIKE '%additional%' OR
    main::text IN ('0', 'f', 'n')
);

-- Set any remaining invalid values to NULL (safer than guessing)
UPDATE public.lead_leadcontact 
SET main = NULL
WHERE main::text NOT IN ('true', 'false') AND main IS NOT NULL;

-- 4. Verify all values are now valid
SELECT 
    'Verification: Invalid main values remaining' as status,
    COUNT(*) as count
FROM public.lead_leadcontact 
WHERE main::text NOT IN ('true', 'false') AND main IS NOT NULL;

-- 5. Show final distribution of main values
SELECT 
    'Final main values distribution' as status,
    COALESCE(main::text, 'NULL') as value,
    COUNT(*) as count
FROM public.lead_leadcontact 
GROUP BY main
ORDER BY 
    CASE main 
        WHEN 'true' THEN 1 
        WHEN 'false' THEN 2 
        WHEN NULL THEN 3 
        ELSE 4 
    END;

-- 6. Check for data integrity issues
-- Look for leads with multiple main contacts
SELECT 
    'Leads with multiple main contacts' as issue,
    lead_id,
    COUNT(*) as main_contact_count
FROM public.lead_leadcontact 
WHERE main = 'true'
GROUP BY lead_id
HAVING COUNT(*) > 1
ORDER BY main_contact_count DESC
LIMIT 5;

-- 7. Show leads with no main contact
SELECT 
    'Leads with no main contact' as issue,
    lead_id,
    COUNT(*) as total_contacts
FROM public.lead_leadcontact 
GROUP BY lead_id
HAVING COUNT(CASE WHEN main = 'true' THEN 1 END) = 0
ORDER BY total_contacts DESC
LIMIT 5;

-- 8. Auto-fix leads with no main contact (optional - uncomment if needed)
/*
WITH leads_without_main AS (
    SELECT 
        lead_id,
        MIN(id) as first_contact_relationship_id
    FROM public.lead_leadcontact 
    WHERE lead_id IN (
        SELECT lead_id 
        FROM public.lead_leadcontact 
        GROUP BY lead_id
        HAVING COUNT(CASE WHEN main = 'true' THEN 1 END) = 0
    )
    GROUP BY lead_id
)
UPDATE public.lead_leadcontact 
SET main = 'true'
WHERE id IN (
    SELECT first_contact_relationship_id 
    FROM leads_without_main
);
*/

-- 9. Final summary
SELECT 
    'Data cleanup summary' as status,
    (SELECT COUNT(*) FROM public.lead_leadcontact WHERE main = 'true') as main_contacts,
    (SELECT COUNT(*) FROM public.lead_leadcontact WHERE main = 'false') as secondary_contacts,
    (SELECT COUNT(*) FROM public.lead_leadcontact WHERE main IS NULL) as null_contacts,
    (SELECT COUNT(DISTINCT lead_id) FROM public.lead_leadcontact) as total_leads_with_contacts,
    (SELECT COUNT(*) FROM public.lead_leadcontact) as total_relationships;
