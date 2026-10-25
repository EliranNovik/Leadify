-- Dropping a folder onto the drive keeps the tree it was dropped with. Cases already had that,
-- because their folders nest; office and personal folders were one flat level, so a dropped
-- subfolder had nowhere to go and the whole tree collapsed into the space's top level.
--
-- This gives both of those tables a parent of their own kind. Nothing else changes: existing
-- folders simply have no parent, which is exactly where they are today.
--
-- Run sql/2026-08-19_office_documents.sql and sql/2026-08-19_employee_personal_space.sql first.
-- Re-run sql/2026-10-21_document_index_view.sql afterwards — it reports the full folder path for
-- these two stores, which it can only do once the parent exists.
--
-- Safe to re-run.

-- ---------------------------------------------------------------------------
-- Office / department spaces
-- ---------------------------------------------------------------------------

ALTER TABLE public.office_document_folders
  ADD COLUMN IF NOT EXISTS parent_id UUID;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'office_document_folders_parent_id_fkey'
  ) THEN
    -- Deleting a folder takes the folders inside it too. The files are only unfiled, which is
    -- what office_documents.folder_id ON DELETE SET NULL already does.
    ALTER TABLE public.office_document_folders
      ADD CONSTRAINT office_document_folders_parent_id_fkey
      FOREIGN KEY (parent_id) REFERENCES public.office_document_folders(id) ON DELETE CASCADE;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS office_document_folders_parent_idx
  ON public.office_document_folders (parent_id, sort_order, created_at);

-- ---------------------------------------------------------------------------
-- An employee's own space
-- ---------------------------------------------------------------------------

ALTER TABLE public.employee_personal_folders
  ADD COLUMN IF NOT EXISTS parent_id UUID;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'employee_personal_folders_parent_id_fkey'
  ) THEN
    ALTER TABLE public.employee_personal_folders
      ADD CONSTRAINT employee_personal_folders_parent_id_fkey
      FOREIGN KEY (parent_id) REFERENCES public.employee_personal_folders(id) ON DELETE CASCADE;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS employee_personal_folders_parent_idx
  ON public.employee_personal_folders (employee_id, parent_id, sort_order, created_at);

-- A folder cannot sit inside another space's folder: the child is kept with its parent's owner,
-- so a tree always belongs to one department or one employee.
CREATE OR REPLACE FUNCTION public.space_folder_parent_matches()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  parent_owner TEXT;
BEGIN
  IF NEW.parent_id IS NULL THEN
    RETURN NEW;
  END IF;

  IF NEW.parent_id = NEW.id THEN
    RAISE EXCEPTION 'A folder cannot be its own parent';
  END IF;

  IF TG_TABLE_NAME = 'office_document_folders' THEN
    SELECT COALESCE(department_id::text, 'admins') INTO parent_owner
    FROM public.office_document_folders WHERE id = NEW.parent_id;
    IF parent_owner IS DISTINCT FROM COALESCE(NEW.department_id::text, 'admins') THEN
      RAISE EXCEPTION 'A folder must stay in the same office space as the folder it sits in';
    END IF;
  ELSE
    SELECT employee_id::text INTO parent_owner
    FROM public.employee_personal_folders WHERE id = NEW.parent_id;
    IF parent_owner IS DISTINCT FROM NEW.employee_id::text THEN
      RAISE EXCEPTION 'A folder must stay in the same space as the folder it sits in';
    END IF;
  END IF;

  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS office_document_folders_parent_matches ON public.office_document_folders;
CREATE TRIGGER office_document_folders_parent_matches
  BEFORE INSERT OR UPDATE OF parent_id, department_id ON public.office_document_folders
  FOR EACH ROW EXECUTE FUNCTION public.space_folder_parent_matches();

DROP TRIGGER IF EXISTS employee_personal_folders_parent_matches ON public.employee_personal_folders;
CREATE TRIGGER employee_personal_folders_parent_matches
  BEFORE INSERT OR UPDATE OF parent_id, employee_id ON public.employee_personal_folders
  FOR EACH ROW EXECUTE FUNCTION public.space_folder_parent_matches();

NOTIFY pgrst, 'reload schema';
