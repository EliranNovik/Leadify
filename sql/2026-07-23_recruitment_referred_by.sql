-- Referred-by employee on recruitment candidates (active staff referrer).

ALTER TABLE public.recruitment_candidates
  ADD COLUMN IF NOT EXISTS referred_by_employee_id INTEGER
    REFERENCES public.tenants_employee(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS recruitment_candidates_referred_by_idx
  ON public.recruitment_candidates (referred_by_employee_id);

COMMENT ON COLUMN public.recruitment_candidates.referred_by_employee_id IS
  'tenants_employee id of the staff member who referred this candidate';
