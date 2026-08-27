-- Lead shares: an employee can share a lead with another employee.
-- Recipients see unread shares in the header notification bell.

CREATE TABLE IF NOT EXISTS public.lead_shares (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_number text NOT NULL,
  lead_route_id text NOT NULL,
  lead_name text,
  shared_by_employee_id bigint NOT NULL REFERENCES public.tenants_employee(id) ON DELETE CASCADE,
  shared_with_employee_id bigint NOT NULL REFERENCES public.tenants_employee(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  read_at timestamptz
);

CREATE INDEX IF NOT EXISTS idx_lead_shares_recipient_unread
  ON public.lead_shares (shared_with_employee_id, created_at DESC)
  WHERE read_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_lead_shares_route
  ON public.lead_shares (lead_route_id);

COMMENT ON TABLE public.lead_shares IS
  'Employee-to-employee lead shares shown in the CRM notification bell until marked read.';

ALTER TABLE public.lead_shares ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Authenticated can view lead shares" ON public.lead_shares;
CREATE POLICY "Authenticated can view lead shares"
  ON public.lead_shares
  FOR SELECT
  TO authenticated
  USING (auth.uid() IS NOT NULL);

DROP POLICY IF EXISTS "Authenticated can insert lead shares" ON public.lead_shares;
CREATE POLICY "Authenticated can insert lead shares"
  ON public.lead_shares
  FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() IS NOT NULL);

DROP POLICY IF EXISTS "Authenticated can update lead shares" ON public.lead_shares;
CREATE POLICY "Authenticated can update lead shares"
  ON public.lead_shares
  FOR UPDATE
  TO authenticated
  USING (auth.uid() IS NOT NULL)
  WITH CHECK (auth.uid() IS NOT NULL);

GRANT SELECT, INSERT, UPDATE ON public.lead_shares TO authenticated;
