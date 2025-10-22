-- First, let's check what country IDs exist in both tables
-- and identify the problematic records

-- Check existing country IDs in leads_contact
SELECT 
    'leads_contact' as table_name,
    country_id,
    COUNT(*) as count
FROM leads_contact 
WHERE country_id IS NOT NULL
GROUP BY country_id
ORDER BY country_id;

-- Check existing country IDs in misc_country
SELECT 
    'misc_country' as table_name,
    id,
    name,
    iso_code
FROM misc_country 
ORDER BY id;

-- Find orphaned country_id values in leads_contact
SELECT DISTINCT 
    lc.country_id,
    COUNT(*) as record_count
FROM leads_contact lc
LEFT JOIN misc_country mc ON lc.country_id = mc.id
WHERE lc.country_id IS NOT NULL 
    AND mc.id IS NULL
GROUP BY lc.country_id
ORDER BY lc.country_id;

-- Show some sample records with problematic country_id
SELECT 
    id,
    name,
    country_id,
    email,
    phone
FROM leads_contact 
WHERE country_id IN (
    SELECT DISTINCT lc.country_id
    FROM leads_contact lc
    LEFT JOIN misc_country mc ON lc.country_id = mc.id
    WHERE lc.country_id IS NOT NULL 
        AND mc.id IS NULL
)
LIMIT 10;
