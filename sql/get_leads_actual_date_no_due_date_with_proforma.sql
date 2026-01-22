-- Find legacy leads with actual_date in period 2025-12-23 to 2026-01-21 and no due_date
-- Includes actual_date and proforma existence check
-- Only searches in finances_paymentplanrow and proformainvoice tables (legacy leads)

-- Main query: Legacy leads with actual_date, no due_date, and proforma check
SELECT 
    fppr.lead_id,
    fppr.actual_date,
    fppr.value_base,
    CASE 
        WHEN pf.id IS NOT NULL THEN TRUE 
        ELSE FALSE 
    END AS has_proforma,
    pf.id AS proforma_id,
    pf.cdate AS proforma_created_at,
    pf.total AS proforma_total,
    pf.total_base AS proforma_total_base
FROM 
    finances_paymentplanrow fppr
LEFT JOIN 
    proformainvoice pf ON pf.lead_id::text = fppr.lead_id
WHERE 
    fppr.actual_date IS NOT NULL
    AND fppr.actual_date >= '2025-12-23'::date
    AND fppr.actual_date <= '2026-01-21'::date
    AND fppr.due_date IS NULL
ORDER BY 
    fppr.actual_date DESC, fppr.lead_id;

-- Summary: Count with proforma breakdown
SELECT 
    COUNT(*) AS total_count,
    COUNT(*) FILTER (WHERE pf.id IS NOT NULL) AS with_proforma,
    COUNT(*) FILTER (WHERE pf.id IS NULL) AS without_proforma,
    SUM(fppr.value_base) FILTER (WHERE pf.id IS NOT NULL) AS total_value_with_proforma,
    SUM(fppr.value_base) FILTER (WHERE pf.id IS NULL) AS total_value_without_proforma,
    SUM(fppr.value_base) AS total_value_all
FROM 
    finances_paymentplanrow fppr
LEFT JOIN 
    proformainvoice pf ON pf.lead_id::text = fppr.lead_id
WHERE 
    fppr.actual_date IS NOT NULL
    AND fppr.actual_date >= '2025-12-23'::date
    AND fppr.actual_date <= '2026-01-21'::date
    AND fppr.due_date IS NULL;

-- Alternative: Group by lead_id to see distinct leads
SELECT 
    fppr.lead_id,
    COUNT(*) AS payment_plan_rows_count,
    MIN(fppr.actual_date) AS earliest_actual_date,
    MAX(fppr.actual_date) AS latest_actual_date,
    SUM(fppr.value_base) AS total_value_base,
    CASE 
        WHEN pf.id IS NOT NULL THEN TRUE 
        ELSE FALSE 
    END AS has_proforma,
    pf.id AS proforma_id,
    pf.cdate AS proforma_created_at,
    pf.total AS proforma_total
FROM 
    finances_paymentplanrow fppr
LEFT JOIN 
    proformainvoice pf ON pf.lead_id::text = fppr.lead_id
WHERE 
    fppr.actual_date IS NOT NULL
    AND fppr.actual_date >= '2025-12-23'::date
    AND fppr.actual_date <= '2026-01-21'::date
    AND fppr.due_date IS NULL
GROUP BY 
    fppr.lead_id, pf.id, pf.cdate, pf.total
ORDER BY 
    latest_actual_date DESC, fppr.lead_id;

-- UPDATE ACTION: Set due_date to proforma date (cdate) for rows that have proforma
-- Only updates rows that match the criteria: actual_date in period, no due_date, and have proforma
UPDATE finances_paymentplanrow fppr
SET due_date = pf.cdate
FROM proformainvoice pf
WHERE pf.lead_id::text = fppr.lead_id
    AND fppr.actual_date IS NOT NULL
    AND fppr.actual_date >= '2025-12-23'::date
    AND fppr.actual_date <= '2026-01-21'::date
    AND fppr.due_date IS NULL
    AND pf.cdate IS NOT NULL;

-- Verify the update: Check how many rows were updated
SELECT 
    COUNT(*) AS updated_rows_count,
    MIN(due_date) AS earliest_due_date,
    MAX(due_date) AS latest_due_date
FROM finances_paymentplanrow
WHERE actual_date IS NOT NULL
    AND actual_date >= '2025-12-23'::date
    AND actual_date <= '2026-01-21'::date
    AND due_date IS NOT NULL
    AND EXISTS (
        SELECT 1 
        FROM proformainvoice pf 
        WHERE pf.lead_id::text = finances_paymentplanrow.lead_id
    );
