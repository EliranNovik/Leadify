-- Citizenship application forms: German Antragsformular / Antrag auf Einbürgerung,
-- Austrian Antrag auf Verleihung der Staatsbürgerschaft, and the English equivalents.
-- Safe to re-run.

INSERT INTO public.lead_case_document_types (name, sort_order)
SELECT 'Application', 65
WHERE NOT EXISTS (
  SELECT 1
  FROM public.lead_case_document_types t
  WHERE lower(trim(t.name)) = lower('Application')
);
