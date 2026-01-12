-- ============================================
-- ⭐ RUN THIS QUERY TO SEE LEAD IDs WITH DATE FILTER ⭐
-- ============================================
-- Filtered by contract date from 28/12/2025 to 12/01/2026
-- (Date format in HTML can be either DD/MM/YYYY or MM/DD/YYYY - handles both)
-- (Change the dates below if needed - use DD/MM/YYYY format for the range)
WITH date_extracted AS (
    SELECT 
        llc.lead_id,
        (regexp_match(llc.signed_contract_html::text, '<span class="user-input">([0-9]{1,2}/[0-9]{1,2}/[0-9]{4})</span>'))[1] as date_str
    FROM lead_leadcontact llc
    WHERE 
        llc.signed_contract_html IS NOT NULL
        AND NOT EXISTS (
            SELECT 1 
            FROM leads_leadstage lls 
            WHERE lls.lead_id = llc.lead_id 
            AND lls.stage = 60
        )
        AND (regexp_match(llc.signed_contract_html::text, '<span class="user-input">([0-9]{1,2}/[0-9]{1,2}/[0-9]{4})</span>'))[1] IS NOT NULL
),
date_parsed AS (
    SELECT 
        de.lead_id,
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
)
SELECT DISTINCT 
    dp.lead_id,
    dp.contract_date,
    dp.parsed_date
FROM date_parsed dp
WHERE 
    dp.parsed_date BETWEEN to_date('28/12/2025', 'DD/MM/YYYY') AND to_date('12/01/2026', 'DD/MM/YYYY')
ORDER BY dp.lead_id
LIMIT 50;

-- ============================================
-- LEAD IDs WITHOUT DATE FILTER (All dates)
-- ============================================
-- This will show you the lead_id values (up to 50 rows) without date filtering
SELECT DISTINCT llc.lead_id
FROM lead_leadcontact llc
WHERE 
    llc.signed_contract_html IS NOT NULL
    AND NOT EXISTS (
        SELECT 1 
        FROM leads_leadstage lls 
        WHERE lls.lead_id = llc.lead_id 
        AND lls.stage = 60
    )
ORDER BY llc.lead_id
LIMIT 50;

-- ============================================
-- LEAD NUMBERS WITH DETAILS (Optional - if you want more info)
-- ============================================
-- List of lead numbers with signed_contract_html not null but no stage 60 entry
SELECT DISTINCT 
    llc.lead_id,
    ll.id as leads_lead_id,
    ll.lead_number,
    ll.name
FROM lead_leadcontact llc
INNER JOIN leads_lead ll ON llc.lead_id = ll.id
WHERE 
    llc.signed_contract_html IS NOT NULL
    AND NOT EXISTS (
        SELECT 1 
        FROM leads_leadstage lls 
        WHERE lls.lead_id = llc.lead_id 
        AND lls.stage = 60
    )
ORDER BY llc.lead_id
LIMIT 50;

-- ============================================
-- COUNT QUERY
-- ============================================
-- Count leads in lead_leadcontact with signed_contract_html not null 
-- but no stage 60 entry in leads_leadstage
SELECT COUNT(DISTINCT llc.lead_id) as count_leads
FROM lead_leadcontact llc
WHERE 
    llc.signed_contract_html IS NOT NULL
    AND NOT EXISTS (
        SELECT 1 
        FROM leads_leadstage lls 
        WHERE lls.lead_id = llc.lead_id 
        AND lls.stage = 60
    );

-- Get detailed list of leads matching the criteria
SELECT 
    llc.lead_id,
    llc.id as contact_id,
    ll.lead_number,
    ll.name,
    ll.stage as current_stage,
    llc.signed_contract_html IS NOT NULL as has_contract,
    (SELECT COUNT(*) FROM leads_leadstage lls WHERE lls.lead_id = llc.lead_id AND lls.stage = 60) as stage_60_count
FROM lead_leadcontact llc
INNER JOIN leads_lead ll ON llc.lead_id = ll.id
WHERE 
    llc.signed_contract_html IS NOT NULL
    AND NOT EXISTS (
        SELECT 1 
        FROM leads_leadstage lls 
        WHERE lls.lead_id = llc.lead_id 
        AND lls.stage = 60
    )
ORDER BY llc.lead_id;

-- Alternative query using LEFT JOIN (may be faster depending on data size)
SELECT COUNT(DISTINCT llc.lead_id) as count_leads
FROM lead_leadcontact llc
LEFT JOIN leads_leadstage lls ON llc.lead_id = lls.lead_id AND lls.stage = 60
WHERE 
    llc.signed_contract_html IS NOT NULL
    AND lls.id IS NULL;

-- Get breakdown: leads with contracts vs leads with contracts and stage 60
SELECT 
    COUNT(DISTINCT CASE WHEN llc.signed_contract_html IS NOT NULL THEN llc.lead_id END) as leads_with_contract,
    COUNT(DISTINCT CASE 
        WHEN llc.signed_contract_html IS NOT NULL 
        AND EXISTS (SELECT 1 FROM leads_leadstage lls WHERE lls.lead_id = llc.lead_id AND lls.stage = 60)
        THEN llc.lead_id 
    END) as leads_with_contract_and_stage_60,
    COUNT(DISTINCT CASE 
        WHEN llc.signed_contract_html IS NOT NULL 
        AND NOT EXISTS (SELECT 1 FROM leads_leadstage lls WHERE lls.lead_id = llc.lead_id AND lls.stage = 60)
        THEN llc.lead_id 
    END) as leads_with_contract_but_no_stage_60
FROM lead_leadcontact llc;
