-- Get list of lead_id values that have actual_date but no due_date
-- This identifies payment plan rows that have been paid (actual_date exists) 
-- but don't have a scheduled due date
-- Includes actual_date and value_base for each row

SELECT 
  lead_id,
  actual_date,
  value_base
FROM public.finances_paymentplanrow
WHERE actual_date IS NOT NULL
  AND due_date IS NULL
  AND lead_id IS NOT NULL
ORDER BY lead_id, actual_date;

-- Alternative: If you want to see the count of payment plan rows per lead with totals
-- SELECT 
--   lead_id,
--   COUNT(*) as payment_count,
--   SUM(value) as total_value,
--   SUM(value_base) as total_value_base,
--   MIN(actual_date) as first_actual_date,
--   MAX(actual_date) as last_actual_date
-- FROM public.finances_paymentplanrow
-- WHERE actual_date IS NOT NULL
--   AND due_date IS NULL
--   AND lead_id IS NOT NULL
-- GROUP BY lead_id
-- ORDER BY lead_id;

-- Alternative: Get distinct lead_id with aggregated values
-- SELECT DISTINCT
--   lead_id,
--   MIN(actual_date) as earliest_actual_date,
--   MAX(actual_date) as latest_actual_date,
--   SUM(value_base) as total_value_base
-- FROM public.finances_paymentplanrow
-- WHERE actual_date IS NOT NULL
--   AND due_date IS NULL
--   AND lead_id IS NOT NULL
-- GROUP BY lead_id
-- ORDER BY lead_id;
