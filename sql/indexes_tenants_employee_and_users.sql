-- =============================================================================
-- Indexes for tenants_employee and users (employee_id) – fast profile/display lookups
-- =============================================================================
-- Used by: ClientHeader.tsx, Clients.tsx, CasesTab, MeetingTab, HighlightsPanel,
-- CalendarPage, ExpertPage, users join on employee_id → tenants_employee.id, etc.
-- Run in Supabase SQL Editor. Safe to run multiple times (IF NOT EXISTS).
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. TENANTS_EMPLOYEE
-- -----------------------------------------------------------------------------
-- id is primary key (already indexed) – used for users.employee_id → tenants_employee.id joins.

-- display_name: ORDER BY display_name (dropdowns, lists) and WHERE display_name = x / ILIKE x
CREATE INDEX IF NOT EXISTS idx_tenants_employee_display_name
  ON public.tenants_employee (display_name)
  WHERE display_name IS NOT NULL AND display_name <> '';

-- display_name with text_pattern_ops: for ILIKE 'prefix%' if you search by name
CREATE INDEX IF NOT EXISTS idx_tenants_employee_display_name_pattern
  ON public.tenants_employee (display_name text_pattern_ops)
  WHERE display_name IS NOT NULL AND display_name <> '';

-- user_id: lookup employee by auth user (e.g. CalendarPage .eq('user_id', user.id))
-- Only create if column exists; skip if your schema has no user_id on tenants_employee.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'tenants_employee' AND column_name = 'user_id'
  ) THEN
    CREATE INDEX IF NOT EXISTS idx_tenants_employee_user_id
      ON public.tenants_employee (user_id)
      WHERE user_id IS NOT NULL;
  END IF;
END $$;

-- -----------------------------------------------------------------------------
-- 2. USERS – employee_id (join to tenants_employee)
-- -----------------------------------------------------------------------------
-- Fast lookup: users.employee_id → tenants_employee.id (e.g. ClientHeader/Clients
-- resolving current user's display_name from users + tenants_employee).
CREATE INDEX IF NOT EXISTS idx_users_employee_id
  ON public.users (employee_id)
  WHERE employee_id IS NOT NULL;

-- =============================================================================
-- Verify (optional)
-- =============================================================================
-- SELECT schemaname, tablename, indexname, indexdef
-- FROM pg_indexes
-- WHERE tablename IN ('tenants_employee', 'users')
-- ORDER BY tablename, indexname;
