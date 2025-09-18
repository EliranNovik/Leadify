-- Migrate category data from text to foreign key IDs in leads table
-- This script will populate the category_id column based on existing category names

-- First, let's see the current state
DO $$
DECLARE
    total_leads INTEGER;
    leads_with_category_text INTEGER;
    leads_with_category_id INTEGER;
    categories_count INTEGER;
BEGIN
    SELECT COUNT(*) INTO total_leads FROM public.leads;
    SELECT COUNT(*) INTO leads_with_category_text FROM public.leads WHERE category IS NOT NULL AND category != '';
    SELECT COUNT(*) INTO leads_with_category_id FROM public.leads WHERE category_id IS NOT NULL;
    SELECT COUNT(*) INTO categories_count FROM public.misc_category;
    
    RAISE NOTICE '=== BEFORE MIGRATION ===';
    RAISE NOTICE 'Total leads: %', total_leads;
    RAISE NOTICE 'Leads with category text: %', leads_with_category_text;
    RAISE NOTICE 'Leads with category_id: %', leads_with_category_id;
    RAISE NOTICE 'Total categories available: %', categories_count;
END $$;

-- Show some sample category mappings that will be made
SELECT 
    l.category as "Current Category Text",
    mc.id as "Will Map to Category ID",
    mc.name as "Category Name in misc_category",
    COUNT(l.id) as "Number of Leads"
FROM public.leads l
LEFT JOIN public.misc_category mc ON TRIM(LOWER(l.category)) = TRIM(LOWER(mc.name))
WHERE l.category IS NOT NULL 
    AND l.category != ''
    AND l.category_id IS NULL
GROUP BY l.category, mc.id, mc.name
ORDER BY COUNT(l.id) DESC
LIMIT 10;

-- Update leads.category_id based on exact name matches
UPDATE public.leads 
SET category_id = mc.id
FROM public.misc_category mc
WHERE TRIM(LOWER(public.leads.category)) = TRIM(LOWER(mc.name))
    AND public.leads.category IS NOT NULL 
    AND public.leads.category != ''
    AND public.leads.category_id IS NULL;

-- For partial matches (in case category names don't match exactly)
-- This handles cases where the category text might have slight differences
UPDATE public.leads 
SET category_id = mc.id
FROM public.misc_category mc
WHERE public.leads.category ILIKE '%' || mc.name || '%'
    AND public.leads.category IS NOT NULL 
    AND public.leads.category != ''
    AND public.leads.category_id IS NULL
    AND LENGTH(mc.name) > 5; -- Only for meaningful category names

-- Alternative: Update based on LIKE pattern for common variations
UPDATE public.leads 
SET category_id = mc.id
FROM public.misc_category mc
WHERE (
    -- Handle common variations
    REPLACE(REPLACE(LOWER(public.leads.category), ' ', ''), ',', '') = 
    REPLACE(REPLACE(LOWER(mc.name), ' ', ''), ',', '')
    OR
    -- Handle cases with extra text
    LOWER(public.leads.category) LIKE '%' || LOWER(mc.name) || '%'
    OR
    LOWER(mc.name) LIKE '%' || LOWER(public.leads.category) || '%'
)
AND public.leads.category IS NOT NULL 
AND public.leads.category != ''
AND public.leads.category_id IS NULL
AND LENGTH(mc.name) > 3; -- Avoid too generic matches

-- Show results after migration
DO $$
DECLARE
    total_leads INTEGER;
    leads_with_category_text INTEGER;
    leads_with_category_id INTEGER;
    unmapped_leads INTEGER;
BEGIN
    SELECT COUNT(*) INTO total_leads FROM public.leads;
    SELECT COUNT(*) INTO leads_with_category_text FROM public.leads WHERE category IS NOT NULL AND category != '';
    SELECT COUNT(*) INTO leads_with_category_id FROM public.leads WHERE category_id IS NOT NULL;
    SELECT COUNT(*) INTO unmapped_leads FROM public.leads WHERE category IS NOT NULL AND category != '' AND category_id IS NULL;
    
    RAISE NOTICE '=== AFTER MIGRATION ===';
    RAISE NOTICE 'Total leads: %', total_leads;
    RAISE NOTICE 'Leads with category text: %', leads_with_category_text;
    RAISE NOTICE 'Leads with category_id: %', leads_with_category_id;
    RAISE NOTICE 'Unmapped leads (still need manual review): %', unmapped_leads;
    
    IF unmapped_leads > 0 THEN
        RAISE NOTICE 'Migration incomplete. % leads still need category_id mapping.', unmapped_leads;
    ELSE
        RAISE NOTICE 'Migration successful! All leads with categories now have category_id.';
    END IF;
END $$;

-- Show unmapped categories that need manual review
SELECT 
    category as "Unmapped Category Text",
    COUNT(*) as "Number of Leads"
FROM public.leads 
WHERE category IS NOT NULL 
    AND category != ''
    AND category_id IS NULL
GROUP BY category
ORDER BY COUNT(*) DESC;

-- Show successful mappings
SELECT 
    mc.name as "Category Name",
    mc.id as "Category ID",
    COUNT(l.id) as "Number of Leads Mapped"
FROM public.leads l
JOIN public.misc_category mc ON l.category_id = mc.id
GROUP BY mc.id, mc.name
ORDER BY COUNT(l.id) DESC
LIMIT 15;

-- Create a view to see the full mapping for verification
CREATE OR REPLACE VIEW leads_category_mapping AS
SELECT 
    l.id as lead_id,
    l.lead_number,
    l.name as lead_name,
    l.category as original_category_text,
    l.category_id,
    mc.name as mapped_category_name,
    mmc.name as main_category_name,
    td.name as department_name
FROM public.leads l
LEFT JOIN public.misc_category mc ON l.category_id = mc.id
LEFT JOIN public.misc_maincategory mmc ON mc.parent_id = mmc.id
LEFT JOIN public.tenant_departement td ON mmc.department_id = td.id
WHERE l.category IS NOT NULL AND l.category != ''
ORDER BY l.id DESC;

-- Final status message
DO $$
BEGIN
    RAISE NOTICE 'Created view "leads_category_mapping" for verification';
    RAISE NOTICE 'You can query it with: SELECT * FROM leads_category_mapping LIMIT 10;';
    RAISE NOTICE 'Migration script completed successfully!';
END $$;
