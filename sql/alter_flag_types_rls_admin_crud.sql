-- =============================================================================
-- Enable CRUD for flag_types from the Admin UI.
-- Run in Supabase SQL Editor AFTER sql/create_flag_types.sql.
-- =============================================================================

ALTER TABLE public.flag_types ENABLE ROW LEVEL SECURITY;

-- Read is already allowed; add write policies for authenticated users.
DROP POLICY IF EXISTS "Authenticated users can insert flag_types" ON public.flag_types;
DROP POLICY IF EXISTS "Authenticated users can update flag_types" ON public.flag_types;
DROP POLICY IF EXISTS "Authenticated users can delete flag_types" ON public.flag_types;

CREATE POLICY "Authenticated users can insert flag_types"
  ON public.flag_types
  FOR INSERT
  TO authenticated
  WITH CHECK (true);

CREATE POLICY "Authenticated users can update flag_types"
  ON public.flag_types
  FOR UPDATE
  TO authenticated
  USING (true)
  WITH CHECK (true);

CREATE POLICY "Authenticated users can delete flag_types"
  ON public.flag_types
  FOR DELETE
  TO authenticated
  USING (true);

GRANT INSERT, UPDATE, DELETE ON TABLE public.flag_types TO authenticated;

