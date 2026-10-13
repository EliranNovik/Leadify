-- Name a department's manager on the department itself, and set Immigration to Israel to Ariel (19).
--
-- Why not just set bonuses_role = 'dm' on employee 19
-- ---------------------------------------------------
-- Because `bonuses_role` is not a label, it is load-bearing in several unrelated places:
--
--   * bonus pools are split by headcount per role, so moving Ariel out of 'h' (29 employees) and into
--     'dm' (2) changes real bonus money for him, for the other 28 handlers, and for the two existing
--     managers, Rebecca and Shira;
--   * Handler Management lists staff whose role is 'h' or 'dm';
--   * the Reports page treats everyone with 'dm' as a supervisor;
--   * lead time reporting was switched on for exactly the 'h' and 'dm' population.
--
-- So "who manages this department" gets its own column. It is also the more honest model: a
-- department's manager is a fact about the department, not a side effect of how someone is paid.
--
-- The old lookup stays as a fallback, so the two departments that already resolve a manager through
-- `bonuses_role` keep working with no data migration and no behaviour change.

BEGIN;

ALTER TABLE public.tenant_departement
  ADD COLUMN IF NOT EXISTS manager_employee_id BIGINT
    REFERENCES public.tenants_employee (id) ON DELETE SET NULL;

COMMENT ON COLUMN public.tenant_departement.manager_employee_id IS
  'The department manager shown to clients (portal dashboard, reassignment emails). Takes precedence over the tenants_employee.bonuses_role = ''dm'' lookup. Set this rather than editing bonuses_role, which drives bonus pools and staff permissions.';

-- Ariel Galili, employee 19, already sits in department 4 (Immigration to Israel).
UPDATE public.tenant_departement
SET manager_employee_id = 19
WHERE id = 4;

/*
 * Portal dashboard resolution, in precedence order.
 *
 * Both arms stay gated on `_portal_employee_is_active`, which is what keeps a departed manager out of
 * a client's view. That check is why the explicit column cannot simply be read directly: a named
 * manager who leaves must disappear the same way a role-flagged one does.
 */
CREATE OR REPLACE FUNCTION public._portal_department_manager_employee_id(p_department_id BIGINT)
RETURNS BIGINT
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(
    (
      SELECT td.manager_employee_id
      FROM public.tenant_departement td
      WHERE td.id = p_department_id
        AND td.manager_employee_id IS NOT NULL
        AND public._portal_employee_is_active(td.manager_employee_id)
    ),
    (
      SELECT te.id
      FROM public.tenants_employee te
      WHERE te.department_id = p_department_id
        AND lower(trim(COALESCE(te.bonuses_role, ''))) IN ('dm', 'department manager')
        AND public._portal_employee_is_active(te.id)
      ORDER BY te.id
      LIMIT 1
    )
  );
$$;

GRANT EXECUTE ON FUNCTION public._portal_department_manager_employee_id(BIGINT) TO anon, authenticated;

COMMIT;

NOTIFY pgrst, 'reload schema';

-- Verification — run after COMMIT.
--
-- Immigration to Israel should resolve to 19, and the two existing departments should be unchanged
-- (5 -> 43 Rebecca, 2 -> 61 Shira). Every other department should still come back NULL.
-- SELECT
--   td.id,
--   td.name,
--   td.manager_employee_id AS named,
--   public._portal_department_manager_employee_id(td.id) AS resolved
-- FROM public.tenant_departement td
-- ORDER BY td.id;
--
-- Rollback:
-- BEGIN;
-- UPDATE public.tenant_departement SET manager_employee_id = NULL WHERE id = 4;
-- COMMIT;
--
-- To drop the mechanism entirely, restore the function body from
-- sql/2026-08-02_portal_hide_inactive_legal_team.sql and then:
-- ALTER TABLE public.tenant_departement DROP COLUMN manager_employee_id;
