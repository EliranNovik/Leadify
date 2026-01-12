-- Check how many proforma invoices have NULL creator_id and are connected to legacy leads
-- that have payments with actual_date NULL (unpaid payments)

SELECT 
    COUNT(DISTINCT pi.id) as proforma_count,
    COUNT(DISTINCT pi.lead_id) as unique_leads_count,
    COUNT(DISTINCT fpp.id) as unpaid_payments_count
FROM proformainvoice pi
INNER JOIN leads_lead ll ON pi.lead_id = ll.id
INNER JOIN finances_paymentplanrow fpp ON fpp.lead_id::bigint = ll.id
WHERE 
    pi.creator_id IS NULL
    AND fpp.actual_date IS NULL
    AND pi.cxd_date IS NULL; -- Only active proformas (not cancelled)

-- Detailed breakdown: Show the proforma invoices with their details
SELECT 
    pi.id as proforma_id,
    pi.lead_id,
    ll.name as lead_name,
    pi.cdate as proforma_date,
    pi.total,
    pi.total_base,
    COUNT(DISTINCT fpp.id) as unpaid_payments_count,
    SUM(fpp.value) as total_unpaid_amount
FROM proformainvoice pi
INNER JOIN leads_lead ll ON pi.lead_id = ll.id
INNER JOIN finances_paymentplanrow fpp ON fpp.lead_id::bigint = ll.id
WHERE 
    pi.creator_id IS NULL
    AND fpp.actual_date IS NULL
    AND pi.cxd_date IS NULL -- Only active proformas (not cancelled)
GROUP BY 
    pi.id,
    pi.lead_id,
    ll.name,
    pi.cdate,
    pi.total,
    pi.total_base
ORDER BY 
    pi.cdate DESC;

-- DELETE query: Remove proforma invoices matching the criteria
-- WARNING: This will permanently delete the proforma invoices!
-- Run the SELECT queries above first to verify what will be deleted

DELETE FROM proformainvoice pi
WHERE pi.id IN (
    SELECT DISTINCT pi2.id
    FROM proformainvoice pi2
    INNER JOIN leads_lead ll ON pi2.lead_id = ll.id
    INNER JOIN finances_paymentplanrow fpp ON fpp.lead_id::bigint = ll.id
    WHERE 
        pi2.creator_id IS NULL
        AND fpp.actual_date IS NULL
        AND pi2.cxd_date IS NULL -- Only active proformas (not cancelled)
);

-- Alternative: If you want to see what will be deleted before running DELETE, use this:
-- SELECT pi.id, pi.lead_id, ll.name as lead_name, pi.cdate
-- FROM proformainvoice pi
-- INNER JOIN leads_lead ll ON pi.lead_id = ll.id
-- INNER JOIN finances_paymentplanrow fpp ON fpp.lead_id::bigint = ll.id
-- WHERE 
--     pi.creator_id IS NULL
--     AND fpp.actual_date IS NULL
--     AND pi.cxd_date IS NULL
-- GROUP BY pi.id, pi.lead_id, ll.name, pi.cdate;
