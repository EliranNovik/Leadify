-- Smart Scan: Israeli Corporations Authority winding-up hearing summons
-- (רשות התאגידים / יחידת אכיפה ובקרה — זימון לדיון בבקשת פירוק).
-- Safe to re-run.

INSERT INTO public.lead_case_document_types (name, sort_order)
SELECT 'Dissolution Hearing Summons', 70
WHERE NOT EXISTS (
  SELECT 1
  FROM public.lead_case_document_types t
  WHERE lower(trim(t.name)) = lower('Dissolution Hearing Summons')
);
