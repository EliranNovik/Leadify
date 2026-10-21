-- Nestable document folders shared by the Case documents drawer and (later) the central
-- documents page. One tree serves every scope, keyed by (scope_type, scope_key), so leads,
-- the office space, employee space and staff meetings can all hang folders off the same table
-- instead of each getting another flat copy like public.lead_sub_effort_folders.
--
-- Membership is folder_id on the document row (lead_case_documents here; other stores can add
-- the same column later). Storage object paths are unchanged: the tree lives only in Postgres.
--
-- Access is opt-in: a folder with no grant anywhere up its parent chain stays visible to every
-- authenticated member of staff, so existing behaviour is untouched until an admin restricts a
-- folder. Safe to re-run.

-- ---------------------------------------------------------------------------
-- Identity helpers
-- ---------------------------------------------------------------------------

-- Matches the frontend rule in src/lib/userRole.ts. The older is_app_superuser() covers the
-- is_superuser flag only, which is narrower than what the UI calls an admin.
CREATE OR REPLACE FUNCTION public.is_app_admin()
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
      AND (
        u.role = 'admin'
        OR u.is_staff IS TRUE
        OR u.is_superuser IS TRUE
        OR u.is_superuser::text IN ('true', 't', '1')
      )
  );
$$;

GRANT EXECUTE ON FUNCTION public.is_app_admin() TO authenticated;

CREATE OR REPLACE FUNCTION public.current_user_employee_id()
RETURNS bigint
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT u.employee_id
  FROM public.users u
  WHERE u.auth_id = auth.uid()
  LIMIT 1;
$$;

GRANT EXECUTE ON FUNCTION public.current_user_employee_id() TO authenticated;

-- ---------------------------------------------------------------------------
-- Folders
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.document_folders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  parent_id uuid NULL REFERENCES public.document_folders (id) ON DELETE CASCADE,
  scope_type text NOT NULL CHECK (scope_type IN ('lead', 'office', 'employee', 'staff_meeting')),
  scope_key text NOT NULL,
  classification_id uuid NULL REFERENCES public.case_document_classifications (id) ON DELETE CASCADE,
  area text NULL,
  title text NOT NULL,
  note text NULL,
  path text NOT NULL DEFAULT '',
  depth integer NOT NULL DEFAULT 0,
  sort_order integer NOT NULL DEFAULT 0,
  created_by text NULL,
  created_by_employee_id bigint NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.document_folders IS
  'Nestable folders for document stores. Scope is (scope_type, scope_key); for leads scope_key is the lead number and classification_id is the Case documents tab.';
COMMENT ON COLUMN public.document_folders.area IS
  'Mirrors lead_case_documents.onedrive_subfolder so the header drawer and the Expert tab keep separate trees.';
COMMENT ON COLUMN public.document_folders.path IS
  'Materialised title path (passports/2026) maintained by trigger, for breadcrumbs and search.';

ALTER TABLE public.document_folders
  ADD COLUMN IF NOT EXISTS created_by_employee_id bigint;

CREATE INDEX IF NOT EXISTS idx_document_folders_scope
  ON public.document_folders (scope_type, scope_key, classification_id, sort_order, created_at);

CREATE INDEX IF NOT EXISTS idx_document_folders_parent
  ON public.document_folders (parent_id);

CREATE INDEX IF NOT EXISTS idx_document_folders_path
  ON public.document_folders (scope_type, scope_key, path);

-- Re-dropping the same folder tree reuses the existing rows rather than duplicating them.
-- COALESCE keeps NULL parent/classification/area from defeating the constraint.
CREATE UNIQUE INDEX IF NOT EXISTS uq_document_folders_sibling_title
  ON public.document_folders (
    scope_type,
    scope_key,
    COALESCE(classification_id, '00000000-0000-0000-0000-000000000000'::uuid),
    COALESCE(parent_id, '00000000-0000-0000-0000-000000000000'::uuid),
    COALESCE(area, ''),
    lower(title)
  );

-- ---------------------------------------------------------------------------
-- Path / depth maintenance
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.document_folders_before_write()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  parent_row public.document_folders;
  walker uuid;
  guard integer := 0;
BEGIN
  -- The descendant resync below writes path and depth itself; recomputing here would read
  -- half-updated parents.
  IF pg_trigger_depth() > 1 THEN
    RETURN NEW;
  END IF;

  NEW.title := btrim(NEW.title);
  IF NEW.title = '' THEN
    RAISE EXCEPTION 'document_folders.title cannot be blank';
  END IF;
  IF position('/' in NEW.title) > 0 THEN
    RAISE EXCEPTION 'document_folders.title cannot contain "/"';
  END IF;

  IF NEW.parent_id IS NULL THEN
    NEW.depth := 0;
    NEW.path := NEW.title;
  ELSE
    IF NEW.parent_id = NEW.id THEN
      RAISE EXCEPTION 'a folder cannot be its own parent';
    END IF;

    SELECT * INTO parent_row FROM public.document_folders WHERE id = NEW.parent_id;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'parent folder % does not exist', NEW.parent_id;
    END IF;

    IF parent_row.scope_type <> NEW.scope_type
       OR parent_row.scope_key <> NEW.scope_key
       OR parent_row.classification_id IS DISTINCT FROM NEW.classification_id
       OR parent_row.area IS DISTINCT FROM NEW.area THEN
      RAISE EXCEPTION 'a folder must sit in the same scope as its parent';
    END IF;

    -- Walk up from the new parent; meeting ourselves means the move would make a loop.
    walker := parent_row.parent_id;
    WHILE walker IS NOT NULL LOOP
      guard := guard + 1;
      IF walker = NEW.id THEN
        RAISE EXCEPTION 'moving this folder into % would create a loop', NEW.parent_id;
      END IF;
      IF guard > 64 THEN
        RAISE EXCEPTION 'document_folders parent chain is too long';
      END IF;
      SELECT parent_id INTO walker FROM public.document_folders WHERE id = walker;
    END LOOP;

    NEW.depth := parent_row.depth + 1;
    NEW.path := parent_row.path || '/' || NEW.title;
  END IF;

  IF NEW.depth > 10 THEN
    RAISE EXCEPTION 'document folders cannot nest deeper than 10 levels';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_document_folders_before_write ON public.document_folders;
CREATE TRIGGER trg_document_folders_before_write
  BEFORE INSERT OR UPDATE ON public.document_folders
  FOR EACH ROW EXECUTE FUNCTION public.document_folders_before_write();

CREATE OR REPLACE FUNCTION public.document_folders_resync_descendants()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF pg_trigger_depth() > 1 THEN
    RETURN NULL;
  END IF;
  IF NEW.path IS NOT DISTINCT FROM OLD.path THEN
    RETURN NULL;
  END IF;

  -- One pass rewrites the whole subtree, so the guard above costs nothing.
  WITH RECURSIVE sub AS (
    SELECT f.id, NEW.path || '/' || f.title AS new_path, NEW.depth + 1 AS new_depth
    FROM public.document_folders f
    WHERE f.parent_id = NEW.id
    UNION ALL
    SELECT c.id, s.new_path || '/' || c.title, s.new_depth + 1
    FROM public.document_folders c
    JOIN sub s ON c.parent_id = s.id
  )
  UPDATE public.document_folders d
  SET path = s.new_path, depth = s.new_depth
  FROM sub s
  WHERE d.id = s.id;

  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS trg_document_folders_resync_descendants ON public.document_folders;
CREATE TRIGGER trg_document_folders_resync_descendants
  AFTER UPDATE ON public.document_folders
  FOR EACH ROW EXECUTE FUNCTION public.document_folders_resync_descendants();

-- ---------------------------------------------------------------------------
-- Access grants
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.document_folder_access (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  folder_id uuid NOT NULL REFERENCES public.document_folders (id) ON DELETE CASCADE,
  employee_id bigint NULL REFERENCES public.tenants_employee (id) ON DELETE CASCADE,
  department_id bigint NULL REFERENCES public.tenant_departement (id) ON DELETE CASCADE,
  role text NULL,
  can_view boolean NOT NULL DEFAULT true,
  can_edit boolean NOT NULL DEFAULT false,
  granted_by_employee_id bigint NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT document_folder_access_one_subject
    CHECK (num_nonnulls(employee_id, department_id, role) = 1)
);

COMMENT ON TABLE public.document_folder_access IS
  'Opt-in folder permissions. A grant covers the folder and everything under it. A folder with no grant in its chain is open to all staff.';

CREATE INDEX IF NOT EXISTS idx_document_folder_access_folder
  ON public.document_folder_access (folder_id);

CREATE UNIQUE INDEX IF NOT EXISTS uq_document_folder_access_subject
  ON public.document_folder_access (
    folder_id,
    COALESCE(employee_id, -1),
    COALESCE(department_id, -1),
    COALESCE(role, '')
  );

-- ---------------------------------------------------------------------------
-- Permission checks
-- ---------------------------------------------------------------------------

-- True when the signed-in user may see the folder. Admins always may. A folder is open unless
-- it or one of its ancestors carries a grant, in which case one of those grants must match the
-- user's employee id, department or login role.
CREATE OR REPLACE FUNCTION public.can_view_document_folder(p_folder_id uuid)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  grant_count integer;
  match_count integer;
BEGIN
  IF p_folder_id IS NULL THEN
    RETURN true;
  END IF;
  IF is_app_admin() THEN
    RETURN true;
  END IF;

  WITH RECURSIVE chain AS (
    SELECT f.id, f.parent_id
    FROM public.document_folders f
    WHERE f.id = p_folder_id
    UNION ALL
    SELECT p.id, p.parent_id
    FROM public.document_folders p
    JOIN chain c ON p.id = c.parent_id
  ),
  grants AS (
    SELECT a.*
    FROM public.document_folder_access a
    JOIN chain c ON c.id = a.folder_id
    WHERE a.can_view IS TRUE
  )
  SELECT
    (SELECT count(*) FROM grants),
    (
      SELECT count(*)
      FROM grants g
      WHERE (g.employee_id IS NOT NULL AND g.employee_id = current_user_employee_id())
         OR (
              g.department_id IS NOT NULL
              AND g.department_id = (
                SELECT e.department_id
                FROM public.tenants_employee e
                WHERE e.id = current_user_employee_id()
              )
            )
         OR (
              g.role IS NOT NULL
              AND g.role = (
                SELECT u.role FROM public.users u WHERE u.auth_id = auth.uid() LIMIT 1
              )
            )
    )
  INTO grant_count, match_count;

  IF grant_count = 0 THEN
    RETURN true;
  END IF;
  RETURN match_count > 0;
END;
$$;

GRANT EXECUTE ON FUNCTION public.can_view_document_folder(uuid) TO authenticated;

-- Same shape as can_view_document_folder, but a matching grant must also allow editing.
CREATE OR REPLACE FUNCTION public.can_edit_document_folder(p_folder_id uuid)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  grant_count integer;
  match_count integer;
BEGIN
  IF p_folder_id IS NULL THEN
    RETURN true;
  END IF;
  IF is_app_admin() THEN
    RETURN true;
  END IF;

  WITH RECURSIVE chain AS (
    SELECT f.id, f.parent_id
    FROM public.document_folders f
    WHERE f.id = p_folder_id
    UNION ALL
    SELECT p.id, p.parent_id
    FROM public.document_folders p
    JOIN chain c ON p.id = c.parent_id
  ),
  grants AS (
    SELECT a.*
    FROM public.document_folder_access a
    JOIN chain c ON c.id = a.folder_id
  )
  SELECT
    (SELECT count(*) FROM grants),
    (
      SELECT count(*)
      FROM grants g
      WHERE g.can_edit IS TRUE
        AND (
             (g.employee_id IS NOT NULL AND g.employee_id = current_user_employee_id())
          OR (
               g.department_id IS NOT NULL
               AND g.department_id = (
                 SELECT e.department_id
                 FROM public.tenants_employee e
                 WHERE e.id = current_user_employee_id()
               )
             )
          OR (
               g.role IS NOT NULL
               AND g.role = (
                 SELECT u.role FROM public.users u WHERE u.auth_id = auth.uid() LIMIT 1
               )
             )
        )
    )
  INTO grant_count, match_count;

  IF grant_count = 0 THEN
    RETURN true;
  END IF;
  RETURN match_count > 0;
END;
$$;

GRANT EXECUTE ON FUNCTION public.can_edit_document_folder(uuid) TO authenticated;

-- ---------------------------------------------------------------------------
-- Document membership
-- ---------------------------------------------------------------------------

ALTER TABLE public.lead_case_documents
  ADD COLUMN IF NOT EXISTS folder_id uuid;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'lead_case_documents_folder_id_fkey'
  ) THEN
    ALTER TABLE public.lead_case_documents
      ADD CONSTRAINT lead_case_documents_folder_id_fkey
      FOREIGN KEY (folder_id) REFERENCES public.document_folders (id) ON DELETE SET NULL;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_lead_case_documents_folder
  ON public.lead_case_documents (lead_number, folder_id);

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------

ALTER TABLE public.document_folders ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.document_folder_access ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "document_folders_select" ON public.document_folders;
CREATE POLICY "document_folders_select" ON public.document_folders
  FOR SELECT
  TO authenticated
  USING (can_view_document_folder(id));

DROP POLICY IF EXISTS "document_folders_insert" ON public.document_folders;
CREATE POLICY "document_folders_insert" ON public.document_folders
  FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() IS NOT NULL AND can_edit_document_folder(parent_id));

DROP POLICY IF EXISTS "document_folders_update" ON public.document_folders;
CREATE POLICY "document_folders_update" ON public.document_folders
  FOR UPDATE
  TO authenticated
  USING (can_edit_document_folder(id))
  WITH CHECK (can_edit_document_folder(id));

DROP POLICY IF EXISTS "document_folders_delete" ON public.document_folders;
CREATE POLICY "document_folders_delete" ON public.document_folders
  FOR DELETE
  TO authenticated
  USING (can_edit_document_folder(id));

-- Only admins hand out or revoke access, but everyone may read the grants on folders they can
-- see, so the drawer can show a lock badge without a round trip through an admin endpoint.
DROP POLICY IF EXISTS "document_folder_access_select" ON public.document_folder_access;
CREATE POLICY "document_folder_access_select" ON public.document_folder_access
  FOR SELECT
  TO authenticated
  USING (is_app_admin() OR can_view_document_folder(folder_id));

DROP POLICY IF EXISTS "document_folder_access_insert" ON public.document_folder_access;
CREATE POLICY "document_folder_access_insert" ON public.document_folder_access
  FOR INSERT
  TO authenticated
  WITH CHECK (is_app_admin());

DROP POLICY IF EXISTS "document_folder_access_update" ON public.document_folder_access;
CREATE POLICY "document_folder_access_update" ON public.document_folder_access
  FOR UPDATE
  TO authenticated
  USING (is_app_admin())
  WITH CHECK (is_app_admin());

DROP POLICY IF EXISTS "document_folder_access_delete" ON public.document_folder_access;
CREATE POLICY "document_folder_access_delete" ON public.document_folder_access
  FOR DELETE
  TO authenticated
  USING (is_app_admin());

-- Documents follow their folder. Rows outside a folder keep the previous rule, so nothing that
-- works today changes until a folder is restricted.
DROP POLICY IF EXISTS "lead_case_documents_select" ON public.lead_case_documents;
CREATE POLICY "lead_case_documents_select" ON public.lead_case_documents
  FOR SELECT
  USING (auth.uid() IS NOT NULL AND can_view_document_folder(folder_id));

GRANT SELECT, INSERT, UPDATE, DELETE ON public.document_folders TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.document_folders TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.document_folder_access TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.document_folder_access TO service_role;
