-- Who covers expenses: client vs office.
-- true  = Client
-- false = Office

ALTER TABLE public.leads
  ADD COLUMN IF NOT EXISTS client_paid boolean NOT NULL DEFAULT true;

ALTER TABLE public.leads_lead
  ADD COLUMN IF NOT EXISTS client_paid boolean NOT NULL DEFAULT true;

COMMENT ON COLUMN public.leads.client_paid IS
  'Finances toggle: true = Client pays, false = Office pays.';

COMMENT ON COLUMN public.leads_lead.client_paid IS
  'Finances toggle: true = Client pays, false = Office pays.';
