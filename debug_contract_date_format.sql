-- ============================================
-- DEBUG: Check actual date format in signed_contract_html
-- ============================================
-- This query will help us see what the actual date format looks like in the HTML
-- Run this first to understand the date format, then adjust the filtering query

-- Show sample of signed_contract_html with dates extracted
SELECT 
    llc.id as contact_id,
    llc.lead_id,
    ll.lead_number,
    ll.name,
    -- Try to find date patterns in various formats
    (regexp_match(llc.signed_contract_html::text, '<span class="user-input">([0-9]{1,2}/[0-9]{1,2}/[0-9]{4})</span>'))[1] as date_pattern_1,
    (regexp_match(llc.signed_contract_html::text, '([0-9]{1,2}/[0-9]{1,2}/[0-9]{4})'))[1] as date_pattern_2,
    (regexp_match(llc.signed_contract_html::text, '(\d{1,2}/\d{1,2}/\d{4})'))[1] as date_pattern_3,
    -- Show first 500 characters of HTML to see the structure
    LEFT(llc.signed_contract_html::text, 500) as html_preview
FROM lead_leadcontact llc
INNER JOIN leads_lead ll ON llc.lead_id = ll.id
WHERE 
    llc.signed_contract_html IS NOT NULL
    AND llc.id = 204912  -- Use the contact_id you found
LIMIT 5;

-- ============================================
-- Alternative: Search for dates in different HTML patterns
-- ============================================
-- Try multiple date extraction patterns
WITH date_patterns AS (
    SELECT 
        llc.lead_id,
        llc.id as contact_id,
        -- Pattern 1: <span class="user-input">DD/MM/YYYY</span>
        (regexp_match(llc.signed_contract_html::text, '<span class="user-input">([0-9]{1,2}/[0-9]{1,2}/[0-9]{4})</span>'))[1] as pattern1,
        -- Pattern 2: Just DD/MM/YYYY anywhere in text
        (regexp_match(llc.signed_contract_html::text, '([0-9]{1,2}/[0-9]{1,2}/[0-9]{4})'))[1] as pattern2,
        -- Pattern 3: Date in different span format
        (regexp_match(llc.signed_contract_html::text, '<span[^>]*>([0-9]{1,2}/[0-9]{1,2}/[0-9]{4})</span>'))[1] as pattern3,
        -- Pattern 4: Date after "Date:" or "תאריך:"
        (regexp_match(llc.signed_contract_html::text, '(?:Date:|תאריך:)\s*([0-9]{1,2}/[0-9]{1,2}/[0-9]{4})'))[1] as pattern4,
        llc.signed_contract_html::text as full_html
    FROM lead_leadcontact llc
    WHERE llc.signed_contract_html IS NOT NULL
)
SELECT 
    dp.lead_id,
    dp.contact_id,
    dp.pattern1,
    dp.pattern2,
    dp.pattern3,
    dp.pattern4,
    -- Show which pattern matched
    COALESCE(dp.pattern1, dp.pattern2, dp.pattern3, dp.pattern4) as extracted_date,
    LEFT(dp.full_html, 1000) as html_sample
FROM date_patterns dp
WHERE 
    dp.pattern1 IS NOT NULL 
    OR dp.pattern2 IS NOT NULL 
    OR dp.pattern3 IS NOT NULL 
    OR dp.pattern4 IS NOT NULL
ORDER BY dp.lead_id
LIMIT 20;

-- ============================================
-- FIXED: Date filtering query with multiple pattern support
-- ============================================
-- This version tries multiple date extraction patterns
WITH date_extracted AS (
    SELECT 
        llc.lead_id,
        llc.id as contact_id,
        -- Try multiple patterns and use the first one that matches
        COALESCE(
            (regexp_match(llc.signed_contract_html::text, '<span class="user-input">([0-9]{1,2}/[0-9]{1,2}/[0-9]{4})</span>'))[1],
            (regexp_match(llc.signed_contract_html::text, '<span[^>]*>([0-9]{1,2}/[0-9]{1,2}/[0-9]{4})</span>'))[1],
            (regexp_match(llc.signed_contract_html::text, '(?:Date:|תאריך:)\s*([0-9]{1,2}/[0-9]{1,2}/[0-9]{4})'))[1],
            (regexp_match(llc.signed_contract_html::text, '([0-9]{1,2}/[0-9]{1,2}/[0-9]{4})'))[1]
        ) as date_str
    FROM lead_leadcontact llc
    WHERE 
        llc.signed_contract_html IS NOT NULL
        AND NOT EXISTS (
            SELECT 1 
            FROM leads_leadstage lls 
            WHERE lls.lead_id = llc.lead_id 
            AND lls.stage = 60
        )
        -- Check if any pattern matches
        AND (
            (regexp_match(llc.signed_contract_html::text, '<span class="user-input">([0-9]{1,2}/[0-9]{1,2}/[0-9]{4})</span>'))[1] IS NOT NULL
            OR (regexp_match(llc.signed_contract_html::text, '<span[^>]*>([0-9]{1,2}/[0-9]{1,2}/[0-9]{4})</span>'))[1] IS NOT NULL
            OR (regexp_match(llc.signed_contract_html::text, '(?:Date:|תאריך:)\s*([0-9]{1,2}/[0-9]{1,2}/[0-9]{4})'))[1] IS NOT NULL
            OR (regexp_match(llc.signed_contract_html::text, '([0-9]{1,2}/[0-9]{1,2}/[0-9]{4})'))[1] IS NOT NULL
        )
),
date_parsed AS (
    SELECT 
        de.lead_id,
        de.contact_id,
        de.date_str as contract_date,
        CASE 
            -- If first part > 12, it must be DD/MM/YYYY
            WHEN split_part(de.date_str, '/', 1)::int > 12 THEN
                to_date(de.date_str, 'DD/MM/YYYY')
            -- If second part > 12, it must be MM/DD/YYYY
            WHEN split_part(de.date_str, '/', 2)::int > 12 THEN
                to_date(de.date_str, 'MM/DD/YYYY')
            -- Otherwise, try MM/DD/YYYY first, then DD/MM/YYYY
            ELSE
                COALESCE(
                    NULLIF(
                        CASE WHEN split_part(de.date_str, '/', 1)::int <= 12 
                             THEN to_date(de.date_str, 'MM/DD/YYYY') 
                             ELSE NULL 
                        END, 
                        NULL
                    ),
                    to_date(de.date_str, 'DD/MM/YYYY')
                )
        END as parsed_date
    FROM date_extracted de
    WHERE de.date_str IS NOT NULL
)
SELECT DISTINCT 
    dp.lead_id,
    dp.contact_id,
    dp.contract_date,
    dp.parsed_date,
    ll.lead_number,
    ll.name
FROM date_parsed dp
INNER JOIN leads_lead ll ON dp.lead_id = ll.id
WHERE 
    dp.parsed_date BETWEEN to_date('28/12/2025', 'DD/MM/YYYY') AND to_date('12/01/2026', 'DD/MM/YYYY')
ORDER BY dp.lead_id
LIMIT 50;
