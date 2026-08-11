-- Employee-only comments on CRM email rows (Interactions / Email Thread reading panes).

CREATE TABLE IF NOT EXISTS public.email_comments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email_id text NOT NULL,
  body text NOT NULL,
  created_by text NOT NULL,
  created_by_employee_id bigint NULL REFERENCES public.tenants_employee (id) ON DELETE SET NULL,
  created_by_user_id uuid NULL REFERENCES public.users (id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT email_comments_body_not_blank CHECK (char_length(trim(body)) > 0),
  CONSTRAINT email_comments_body_max_len CHECK (char_length(body) <= 4000)
);

CREATE INDEX IF NOT EXISTS idx_email_comments_email_created
  ON public.email_comments (email_id, created_at ASC);

CREATE INDEX IF NOT EXISTS idx_email_comments_employee
  ON public.email_comments (created_by_employee_id)
  WHERE created_by_employee_id IS NOT NULL;

COMMENT ON TABLE public.email_comments IS
  'Internal employee comments on an emails row (keyed by emails.id as text). Not visible to clients/portal.';
COMMENT ON COLUMN public.email_comments.email_id IS
  'emails.id cast/stored as text (Graph/CRM email primary key).';

ALTER TABLE public.email_comments ENABLE ROW LEVEL SECURITY;

-- Helpers: only staff with a users row + employee_id (excludes portal/external accounts).
CREATE OR REPLACE FUNCTION public.is_crm_employee()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.users u
    WHERE u.auth_id = auth.uid()
      AND u.employee_id IS NOT NULL
  );
$$;

REVOKE ALL ON FUNCTION public.is_crm_employee() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.is_crm_employee() TO authenticated;

DROP POLICY IF EXISTS "email_comments_select_employees" ON public.email_comments;
CREATE POLICY "email_comments_select_employees"
  ON public.email_comments
  FOR SELECT
  TO authenticated
  USING (public.is_crm_employee());

DROP POLICY IF EXISTS "email_comments_insert_employees" ON public.email_comments;
CREATE POLICY "email_comments_insert_employees"
  ON public.email_comments
  FOR INSERT
  TO authenticated
  WITH CHECK (
    public.is_crm_employee()
    AND (
      created_by_user_id IS NULL
      OR created_by_user_id = (SELECT u.id FROM public.users u WHERE u.auth_id = auth.uid() LIMIT 1)
    )
  );

DROP POLICY IF EXISTS "email_comments_update_own" ON public.email_comments;
CREATE POLICY "email_comments_update_own"
  ON public.email_comments
  FOR UPDATE
  TO authenticated
  USING (
    public.is_crm_employee()
    AND (
      created_by_user_id = (SELECT u.id FROM public.users u WHERE u.auth_id = auth.uid() LIMIT 1)
      OR created_by_employee_id = (
        SELECT u.employee_id FROM public.users u WHERE u.auth_id = auth.uid() LIMIT 1
      )
    )
  );

DROP POLICY IF EXISTS "email_comments_delete_own" ON public.email_comments;
CREATE POLICY "email_comments_delete_own"
  ON public.email_comments
  FOR DELETE
  TO authenticated
  USING (
    public.is_crm_employee()
    AND (
      created_by_user_id = (SELECT u.id FROM public.users u WHERE u.auth_id = auth.uid() LIMIT 1)
      OR created_by_employee_id = (
        SELECT u.employee_id FROM public.users u WHERE u.auth_id = auth.uid() LIMIT 1
      )
    )
  );

GRANT SELECT, INSERT, UPDATE, DELETE ON public.email_comments TO authenticated;
GRANT ALL ON public.email_comments TO service_role;
