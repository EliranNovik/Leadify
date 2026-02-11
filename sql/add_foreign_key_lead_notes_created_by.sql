-- Add foreign key relationship between lead_notes.created_by and public.users.id
-- This allows proper joins in Supabase queries
-- 
-- IMPORTANT: If created_by currently stores auth.users(id) values, we need to:
-- 1. Drop the existing foreign key to auth.users (if it exists)
-- 2. Update created_by values to match public.users.id (requires data migration)
-- 3. Add new foreign key to public.users.id
--
-- OR, if created_by already matches public.users.id, we can just add the constraint.

DO $$
DECLARE
  v_current_ref_table TEXT;
  v_constraint_exists BOOLEAN;
  v_constraint_name TEXT;
  v_matching_count INTEGER;
  v_total_count INTEGER;
BEGIN
  -- Check if created_by column exists
  IF NOT EXISTS (
    SELECT 1 
    FROM information_schema.columns 
    WHERE table_schema = 'public' 
    AND table_name = 'lead_notes' 
    AND column_name = 'created_by'
  ) THEN
    RAISE NOTICE 'Column created_by does not exist in lead_notes table';
    RETURN;
  END IF;

  -- Check if any foreign key constraint already exists on created_by
  SELECT EXISTS (
    SELECT 1
    FROM information_schema.table_constraints tc
    JOIN information_schema.key_column_usage kcu
      ON tc.constraint_name = kcu.constraint_name
      AND tc.table_schema = kcu.table_schema
    WHERE tc.constraint_type = 'FOREIGN KEY'
      AND tc.table_name = 'lead_notes'
      AND kcu.column_name = 'created_by'
      AND tc.table_schema = 'public'
  ) INTO v_constraint_exists;

  -- Get the constraint name if it exists
  IF v_constraint_exists THEN
    SELECT tc.constraint_name INTO v_constraint_name
    FROM information_schema.table_constraints tc
    JOIN information_schema.key_column_usage kcu
      ON tc.constraint_name = kcu.constraint_name
      AND tc.table_schema = kcu.table_schema
    WHERE tc.constraint_type = 'FOREIGN KEY'
      AND tc.table_name = 'lead_notes'
      AND kcu.column_name = 'created_by'
      AND tc.table_schema = 'public'
    LIMIT 1;

    -- Check what table it references
    SELECT ccu.table_name INTO v_current_ref_table
    FROM information_schema.table_constraints tc
    JOIN information_schema.key_column_usage kcu
      ON tc.constraint_name = kcu.constraint_name
      AND tc.table_schema = kcu.table_schema
    JOIN information_schema.constraint_column_usage ccu
      ON ccu.constraint_name = tc.constraint_name
      AND ccu.table_schema = tc.table_schema
    WHERE tc.constraint_name = v_constraint_name
    LIMIT 1;

    IF v_current_ref_table = 'users' AND v_constraint_name = 'lead_notes_created_by_fkey' THEN
      RAISE NOTICE 'Foreign key constraint lead_notes_created_by_fkey already exists and references public.users';
      RETURN;
    ELSIF v_current_ref_table = 'users' THEN
      -- Constraint exists but has different name, drop it and recreate with correct name
      EXECUTE format('ALTER TABLE public.lead_notes DROP CONSTRAINT IF EXISTS %I', v_constraint_name);
      RAISE NOTICE 'Dropped existing constraint % to recreate with correct name', v_constraint_name;
    ELSIF v_current_ref_table = 'auth.users' THEN
      -- Drop the constraint to auth.users
      EXECUTE format('ALTER TABLE public.lead_notes DROP CONSTRAINT IF EXISTS %I', v_constraint_name);
      RAISE NOTICE 'Dropped existing constraint % that referenced auth.users', v_constraint_name;
    END IF;
  END IF;

  -- Check if created_by values match public.users.id
  SELECT 
    COUNT(*) FILTER (WHERE ln.created_by = u.id),
    COUNT(*)
  INTO v_matching_count, v_total_count
  FROM lead_notes ln
  LEFT JOIN users u ON ln.created_by = u.id
  WHERE ln.created_by IS NOT NULL;

  IF v_total_count > 0 AND v_matching_count = v_total_count THEN
    -- All values match public.users.id, we can add the constraint
    BEGIN
      ALTER TABLE public.lead_notes
      ADD CONSTRAINT lead_notes_created_by_fkey
      FOREIGN KEY (created_by)
      REFERENCES public.users(id)
      ON DELETE SET NULL;
      
      RAISE NOTICE 'Foreign key constraint lead_notes_created_by_fkey added successfully (references public.users.id)';
    EXCEPTION WHEN OTHERS THEN
      RAISE NOTICE 'Could not add foreign key constraint. Error: %', SQLERRM;
      RAISE NOTICE 'You may need to update created_by values to match public.users.id first';
    END;
  ELSIF v_total_count > 0 THEN
    -- Values don't match - they might be auth.users.id values
    -- Check if they match public.users.auth_id instead
    SELECT COUNT(*) FILTER (WHERE ln.created_by = u.auth_id) INTO v_matching_count
    FROM lead_notes ln
    LEFT JOIN users u ON ln.created_by = u.auth_id
    WHERE ln.created_by IS NOT NULL;

    IF v_matching_count = v_total_count THEN
      RAISE NOTICE 'created_by values match public.users.auth_id, not public.users.id';
      RAISE NOTICE 'To use Supabase joins, you need to update created_by to use public.users.id';
      RAISE NOTICE 'Run this query to update: UPDATE lead_notes ln SET created_by = u.id FROM users u WHERE ln.created_by = u.auth_id';
    ELSE
      RAISE NOTICE 'created_by values do not consistently match public.users.id or public.users.auth_id';
      RAISE NOTICE 'Please review the data and update created_by to reference public.users.id before adding the constraint';
    END IF;
  ELSE
    -- No data, safe to add constraint
    BEGIN
      ALTER TABLE public.lead_notes
      ADD CONSTRAINT lead_notes_created_by_fkey
      FOREIGN KEY (created_by)
      REFERENCES public.users(id)
      ON DELETE SET NULL;
      
      RAISE NOTICE 'Foreign key constraint lead_notes_created_by_fkey added successfully (table is empty)';
    EXCEPTION WHEN OTHERS THEN
      RAISE NOTICE 'Could not add foreign key constraint. Error: %', SQLERRM;
    END;
  END IF;
END $$;

-- Add comment for documentation
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.table_constraints
    WHERE constraint_name = 'lead_notes_created_by_fkey'
    AND table_schema = 'public'
  ) THEN
    COMMENT ON CONSTRAINT lead_notes_created_by_fkey ON public.lead_notes IS 
    'Foreign key relationship linking lead_notes.created_by to public.users.id. Allows Supabase to join user information including employee display_name.';
  END IF;
END $$;
