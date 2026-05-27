-- Inactive meeting locations stay in the DB for historical meetings but are hidden from schedule/edit pickers.
ALTER TABLE public.tenants_meetinglocation
  ADD COLUMN IF NOT EXISTS is_active BOOLEAN DEFAULT true NOT NULL;

CREATE INDEX IF NOT EXISTS idx_tenants_meetinglocation_is_active
  ON public.tenants_meetinglocation (is_active);
