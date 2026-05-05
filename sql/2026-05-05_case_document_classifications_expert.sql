-- Add "Expert" category for case documents tabs
-- Safe to re-run.

insert into public.case_document_classifications (id, slug, label, sort_order, is_active)
select gen_random_uuid(), 'expert', 'Expert', 40, true
where not exists (
  select 1 from public.case_document_classifications where slug = 'expert'
);

