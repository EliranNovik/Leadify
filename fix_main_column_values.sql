-- Fix invalid main column values in lead_leadcontact table
-- This script identifies and corrects invalid values in the main column

-- 1. First, let's see what invalid values exist in the main column
SELECT 
    'Invalid main column values' as issue_type,
    main as current_value,
    COUNT(*) as count
FROM public.lead_leadcontact 
WHERE main NOT IN ('true', 'false') AND main IS NOT NULL
GROUP BY main
ORDER BY count DESC;

-- 2. Show specific records with invalid main values
SELECT 
    id,
    lead_id,
    contact_id,
    main as current_value,
    'Invalid main value' as issue
FROM public.lead_leadcontact 
WHERE main NOT IN ('true', 'false') AND main IS NOT NULL
ORDER BY id
LIMIT 20;

-- 3. Check for common invalid values and their frequencies
SELECT 
    main as value,
    COUNT(*) as frequency,
    CASE 
        WHEN LOWER(main) = '1' OR main = '1' THEN 'Numeric 1 (should be true)'
        WHEN LOWER(main) = '0' OR main = '0' THEN 'Numeric 0 (should be false)'
        WHEN LOWER(main) = 'yes' THEN 'Yes (should be true)'
        WHEN LOWER(main) = 'no' THEN 'No (should be false)'
        WHEN LOWER(main) = 'y' THEN 'Y (should be true)'
        WHEN LOWER(main) = 'n' THEN 'N (should be false)'
        WHEN LOWER(main) = 't' THEN 'T (should be true)'
        WHEN LOWER(main) = 'f' THEN 'F (should be false)'
        WHEN LOWER(main) = 'main' THEN 'Main (should be true)'
        WHEN LOWER(main) = 'primary' THEN 'Primary (should be true)'
        WHEN LOWER(main) = 'secondary' THEN 'Secondary (should be false)'
        ELSE 'Other invalid value'
    END as suggested_fix
FROM public.lead_leadcontact 
WHERE main NOT IN ('true', 'false') AND main IS NOT NULL
GROUP BY main
ORDER BY frequency DESC;

-- 4. Fix common invalid values
-- Convert numeric values (treating all as text)
UPDATE public.lead_leadcontact 
SET main = 'true'
WHERE main IN ('1');

UPDATE public.lead_leadcontact 
SET main = 'false'
WHERE main IN ('0');

-- Convert yes/no values
UPDATE public.lead_leadcontact 
SET main = 'true'
WHERE LOWER(main) IN ('yes', 'y', 't');

UPDATE public.lead_leadcontact 
SET main = 'false'
WHERE LOWER(main) IN ('no', 'n', 'f');

-- Convert descriptive values
UPDATE public.lead_leadcontact 
SET main = 'true'
WHERE LOWER(main) IN ('main', 'primary');

UPDATE public.lead_leadcontact 
SET main = 'false'
WHERE LOWER(main) IN ('secondary', 'additional');

-- 5. Handle any remaining invalid values by setting them to NULL
-- (This is safer than guessing the intended value)
UPDATE public.lead_leadcontact 
SET main = NULL
WHERE main NOT IN ('true', 'false') AND main IS NOT NULL;

-- 6. Verify all values are now valid
SELECT 
    'Remaining invalid main values' as status,
    COUNT(*) as count
FROM public.lead_leadcontact 
WHERE main NOT IN ('true', 'false') AND main IS NOT NULL;

-- 7. Show the distribution of valid values
SELECT 
    'Valid main values distribution' as status,
    COALESCE(main, 'NULL') as value,
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

-- 8. Check for potential data integrity issues after cleanup
-- Look for leads with multiple main contacts
SELECT 
    lead_id,
    COUNT(*) as main_contact_count,
    'Multiple main contacts detected' as issue
FROM public.lead_leadcontact 
WHERE main = 'true'
GROUP BY lead_id
HAVING COUNT(*) > 1
ORDER BY main_contact_count DESC
LIMIT 10;

-- 9. Show leads with no main contact
SELECT 
    lead_id,
    COUNT(*) as total_contacts,
    COUNT(CASE WHEN main = 'true' THEN 1 END) as main_contacts,
    'No main contact' as issue
FROM public.lead_leadcontact 
GROUP BY lead_id
HAVING COUNT(CASE WHEN main = 'true' THEN 1 END) = 0
ORDER BY total_contacts DESC
LIMIT 10;

-- 10. Optional: Auto-fix leads with no main contact by setting the first contact as main
-- Uncomment the following if you want to automatically assign main contacts:

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

-- 11. Final verification
SELECT 
    'Data cleanup completed successfully' as status,
    (SELECT COUNT(*) FROM public.lead_leadcontact WHERE main = 'true') as main_contacts,
    (SELECT COUNT(*) FROM public.lead_leadcontact WHERE main = 'false') as secondary_contacts,
    (SELECT COUNT(*) FROM public.lead_leadcontact WHERE main IS NULL) as null_contacts,
    (SELECT COUNT(DISTINCT lead_id) FROM public.lead_leadcontact) as total_leads_with_contacts;
