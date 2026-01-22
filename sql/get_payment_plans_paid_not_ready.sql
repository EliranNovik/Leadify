-- Get payment plans where paid = TRUE but ready_to_pay = FALSE
-- This identifies payment plans that have been marked as paid
-- but are not marked as ready to pay
-- Includes lead_number from the leads table

SELECT 
  pp.*,
  l.lead_number,
  l.name as lead_name
FROM public.payment_plans pp
LEFT JOIN public.leads l ON l.id = pp.lead_id
WHERE pp.paid = TRUE
  AND pp.ready_to_pay = FALSE
ORDER BY pp.id;

-- Alternative: Get only lead_id and lead_number values
-- SELECT DISTINCT 
--   pp.lead_id,
--   l.lead_number,
--   l.name as lead_name
-- FROM public.payment_plans pp
-- LEFT JOIN public.leads l ON l.id = pp.lead_id
-- WHERE pp.paid = TRUE
--   AND pp.ready_to_pay = FALSE
--   AND pp.lead_id IS NOT NULL
-- ORDER BY l.lead_number;

-- Alternative: Get summary with counts and totals
-- SELECT 
--   COUNT(*) as total_rows,
--   COUNT(DISTINCT lead_id) as unique_leads,
--   SUM(value) as total_value,
--   SUM(value_base) as total_value_base
-- FROM public.payment_plans
-- WHERE paid = TRUE
--   AND ready_to_pay = FALSE;

-- Alternative: With date filter on paid_at (if you want to filter by when it was paid)
-- SELECT 
--   pp.*,
--   l.lead_number,
--   l.name as lead_name
-- FROM public.payment_plans pp
-- LEFT JOIN public.leads l ON l.id = pp.lead_id
-- WHERE pp.paid = TRUE
--   AND pp.ready_to_pay = FALSE
--   AND pp.paid_at >= '2025-12-01'::timestamp
--   AND pp.paid_at <= '2026-01-22 23:59:59'::timestamp
-- ORDER BY pp.paid_at DESC;

-- Alternative: Handle both lead_id and lead_ids fields (if lead_ids is also used)
-- SELECT 
--   pp.*,
--   COALESCE(l1.lead_number, l2.lead_number) as lead_number,
--   COALESCE(l1.name, l2.name) as lead_name
-- FROM public.payment_plans pp
-- LEFT JOIN public.leads l1 ON l1.id = pp.lead_id
-- LEFT JOIN public.leads l2 ON l2.id = pp.lead_ids
-- WHERE pp.paid = TRUE
--   AND pp.ready_to_pay = FALSE
-- ORDER BY pp.id;
