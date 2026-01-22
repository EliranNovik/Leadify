-- Get list of lead_id values that have a proforma invoice but no due_date in payment plan rows
-- This identifies leads that have been invoiced but don't have scheduled payment due dates

-- Option 1: Leads with proforma but no payment plan rows with due_date
SELECT DISTINCT pi.lead_id
FROM public.proformainvoice pi
WHERE pi.lead_id IS NOT NULL
  AND NOT EXISTS (
    SELECT 1
    FROM public.finances_paymentplanrow fpp
    WHERE fpp.lead_id = pi.lead_id::text
      AND fpp.due_date IS NOT NULL
  )
ORDER BY pi.lead_id;

-- Option 2: Leads with proforma but no payment plan rows at all
-- SELECT DISTINCT pi.lead_id
-- FROM public.proformainvoice pi
-- WHERE pi.lead_id IS NOT NULL
--   AND NOT EXISTS (
--     SELECT 1
--     FROM public.finances_paymentplanrow fpp
--     WHERE fpp.lead_id = pi.lead_id::text
--   )
-- ORDER BY pi.lead_id;

-- Option 3: With date filter on proforma creation date (2025-12-01 to 2026-01-22)
-- SELECT DISTINCT pi.lead_id
-- FROM public.proformainvoice pi
-- WHERE pi.lead_id IS NOT NULL
--   AND pi.cdate >= '2025-12-01'
--   AND pi.cdate <= '2026-01-22'
--   AND NOT EXISTS (
--     SELECT 1
--     FROM public.finances_paymentplanrow fpp
--     WHERE fpp.lead_id = pi.lead_id::text
--       AND fpp.due_date IS NOT NULL
--   )
-- ORDER BY pi.lead_id;

-- Option 4: Detailed view with proforma and payment plan info
-- SELECT 
--   pi.lead_id,
--   COUNT(DISTINCT pi.id) as proforma_count,
--   SUM(pi.total) as total_proforma_amount,
--   COUNT(DISTINCT fpp.id) as payment_plan_rows_count,
--   COUNT(DISTINCT CASE WHEN fpp.due_date IS NOT NULL THEN fpp.id END) as rows_with_due_date,
--   COUNT(DISTINCT CASE WHEN fpp.due_date IS NULL THEN fpp.id END) as rows_without_due_date
-- FROM public.proformainvoice pi
-- LEFT JOIN public.finances_paymentplanrow fpp ON fpp.lead_id = pi.lead_id::text
-- WHERE pi.lead_id IS NOT NULL
-- GROUP BY pi.lead_id
-- HAVING COUNT(DISTINCT CASE WHEN fpp.due_date IS NOT NULL THEN fpp.id END) = 0
-- ORDER BY pi.lead_id;
