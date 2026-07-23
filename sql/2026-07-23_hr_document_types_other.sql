-- Allow unmapped recruitment docs (cover letter, portfolio, etc.) to land in HR as "Other".

INSERT INTO public.hr_document_types (slug, label, sort_order) VALUES
  ('other', 'Other', 130)
ON CONFLICT (slug) DO UPDATE SET
  label = EXCLUDED.label,
  sort_order = EXCLUDED.sort_order,
  is_active = TRUE;
