-- Simple query: Get all signed contracts with date signed between 12/12/2025 and 20/12/2025
-- Date format in HTML: <p><strong>Date:</strong> 12.1.26</p> (DD.M.YY format)
WITH date_extracted AS (
    SELECT 
        llc.lead_id,
        -- Extract date from HTML: <strong>Date:</strong> DD.M.YY
        (regexp_match(llc.signed_contract_html::text, '<strong>Date:</strong>\s*([0-9]{1,2}\.[0-9]{1,2}\.[0-9]{2})'))[1] as date_str
    FROM lead_leadcontact llc
    WHERE 
        llc.signed_contract_html IS NOT NULL
        AND (regexp_match(llc.signed_contract_html::text, '<strong>Date:</strong>\s*([0-9]{1,2}\.[0-9]{1,2}\.[0-9]{2})'))[1] IS NOT NULL
),
date_parsed AS (
    SELECT 
        de.lead_id,
        de.date_str,
        -- Parse DD.M.YY format (e.g., 12.1.26 = 12/01/2026)
        -- Convert 2-digit year to 4-digit (assuming 20-99 = 2000-2099, 00-19 = 2000-2019)
        CASE 
            WHEN split_part(de.date_str, '.', 3)::int >= 20 THEN
                to_date(
                    split_part(de.date_str, '.', 1) || '/' || 
                    split_part(de.date_str, '.', 2) || '/' || 
                    '20' || split_part(de.date_str, '.', 3),
                    'DD/MM/YYYY'
                )
            ELSE
                to_date(
                    split_part(de.date_str, '.', 1) || '/' || 
                    split_part(de.date_str, '.', 2) || '/' || 
                    '20' || split_part(de.date_str, '.', 3),
                    'DD/MM/YYYY'
                )
        END as parsed_date
    FROM date_extracted de
    WHERE de.date_str IS NOT NULL
)
SELECT 
    dp.lead_id,
    dp.date_str,
    dp.parsed_date
FROM date_parsed dp
WHERE dp.parsed_date BETWEEN to_date('12/12/2025', 'DD/MM/YYYY') AND to_date('20/12/2025', 'DD/MM/YYYY')
ORDER BY dp.parsed_date, dp.lead_id;
