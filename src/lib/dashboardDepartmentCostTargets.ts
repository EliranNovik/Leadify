import { supabase } from './supabase';
import { fetchAverageGrossSalaryLastMonths } from './employeeSalaries';
import {
  SCOREBOARD_OTHER_DEPARTMENT_IDS,
  SCOREBOARD_OTHER_MAIN_CATEGORY_IDS,
} from './resolveCategoryDepartment';

export type ScoreboardDepartmentRef = {
  id: number;
  name: string;
};

/** Matches Dashboard / CollectionDueReport: strip trailing " - Sales". */
export function normalizeScoreboardDepartmentName(deptName: string): string {
  if (!deptName || deptName === '—') return deptName;
  return deptName.replace(/ - Sales$/i, '').trim();
}

/**
 * Map any real department id (including "X - Sales" / Commercial - Sales) onto the
 * scoreboard column department id, matching Dashboard consolidation rules.
 */
export function buildScoreboardDepartmentCanonicalMap(params: {
  scoreboardDepartments: ScoreboardDepartmentRef[];
  allDepartments: ScoreboardDepartmentRef[];
}): Map<number, number> {
  const { scoreboardDepartments, allDepartments } = params;
  const canonicalById = new Map<number, number>();

  const normalizedToPrimaryId = new Map<string, number>();
  for (const dept of scoreboardDepartments) {
    const normalized = normalizeScoreboardDepartmentName(dept.name);
    if (dept.name === normalized || dept.id === 20) {
      if (!normalizedToPrimaryId.has(normalized)) {
        normalizedToPrimaryId.set(normalized, dept.id);
      }
    }
    // Always map scoreboard dept to itself
    canonicalById.set(dept.id, dept.id);
  }

  // Commercial / Commercial - Sales → id 20 when that column exists
  const hasDept20 = scoreboardDepartments.some((d) => d.id === 20);
  if (hasDept20) {
    normalizedToPrimaryId.set('Commercial & Civil', 20);
    normalizedToPrimaryId.set('Commercial', 20);
    normalizedToPrimaryId.set('Commercial - Sales', 20);
  }

  for (const dept of allDepartments) {
    if (canonicalById.has(dept.id)) continue;
    const normalized = normalizeScoreboardDepartmentName(dept.name);
    const primary =
      normalizedToPrimaryId.get(normalized) ??
      normalizedToPrimaryId.get(dept.name) ??
      (hasDept20 && /commercial/i.test(dept.name) ? 20 : null);
    if (primary != null) {
      canonicalById.set(dept.id, primary);
    }
  }

  // Ensure scoreboard ids always map to themselves
  for (const dept of scoreboardDepartments) {
    canonicalById.set(dept.id, dept.id);
  }

  return canonicalById;
}

/** Scoreboard column for Commercial & Civil (no home employees — uses field %). */
export const SCOREBOARD_COMMERCIAL_CIVIL_DEPT_ID = 20;

/**
 * Dashboard Agreement Signed / Invoiced "Target {Month}" per scoreboard column:
 * 1) 6-month average gross salary of employees whose home department rolls into
 *    column D (including "Austria and Germany - Sales" → "Austria and Germany")
 * 2) For Commercial & Civil only (no direct employees): plus field-assignment
 *    slices — (field_percentage / 100) × 6-month avg gross for assignments whose
 *    field maps to that column (`employee_field_assignments`).
 */
export async function fetchDashboardDepartmentCostTargets(
  scoreboardDepartments: ScoreboardDepartmentRef[],
  options?: {
    salesDeptIdsToExclude?: number[];
    ref?: Date;
  },
): Promise<Map<number, number>> {
  const ref = options?.ref ?? new Date();
  const salesDeptIdsToExclude = options?.salesDeptIdsToExclude ?? [12, 14, 15];
  const scoreboardIds = scoreboardDepartments.map((d) => d.id);

  const targets = new Map<number, number>();
  for (const id of scoreboardIds) targets.set(id, 0);
  if (scoreboardIds.length === 0) return targets;

  const scoreboardIdSet = new Set(scoreboardIds);
  const includeCommercialFieldSlices = scoreboardIdSet.has(SCOREBOARD_COMMERCIAL_CIVIL_DEPT_ID);

  // Related departments: scoreboard columns + sales/sister depts that consolidate into them
  const relatedIdSet = new Set<number>([...scoreboardIds, ...salesDeptIdsToExclude]);

  const { data: relatedDepts, error: relatedError } = await supabase
    .from('tenant_departement')
    .select('id, name')
    .in('id', Array.from(relatedIdSet));
  if (relatedError) {
    console.error('[dashboardDepartmentCostTargets] related departments fetch failed:', relatedError);
  }

  // Also pull any dept whose name normalizes to a scoreboard column (covers renamed sales rows)
  const { data: allDeptsByName, error: byNameError } = await supabase
    .from('tenant_departement')
    .select('id, name');
  if (byNameError) {
    console.error('[dashboardDepartmentCostTargets] all departments fetch failed:', byNameError);
  }

  const allDepartments: ScoreboardDepartmentRef[] = [];
  const seen = new Set<number>();
  for (const dept of [...(relatedDepts || []), ...(allDeptsByName || [])]) {
    const id = Number(dept.id);
    if (!Number.isFinite(id) || seen.has(id)) continue;
    seen.add(id);
    allDepartments.push({ id, name: String(dept.name || '') });
  }

  const canonicalByDeptId = buildScoreboardDepartmentCanonicalMap({
    scoreboardDepartments,
    allDepartments,
  });

  // Only keep source depts that map onto a scoreboard column
  const sourceDeptIds = allDepartments
    .map((d) => d.id)
    .filter((id) => {
      const canonical = canonicalByDeptId.get(id);
      return canonical != null && scoreboardIdSet.has(canonical);
    });

  if (sourceDeptIds.length === 0 && !includeCommercialFieldSlices) return targets;

  const homeEmployeesPromise =
    sourceDeptIds.length > 0
      ? supabase
          .from('tenants_employee')
          .select('id, department_id')
          .in('department_id', sourceDeptIds)
      : Promise.resolve({ data: [] as { id: number; department_id: number | null }[], error: null });

  const assignmentsPromise = includeCommercialFieldSlices
    ? supabase
        .from('employee_field_assignments')
        .select('employee_id, field_percentage, field_id')
        .eq('is_active', true)
    : Promise.resolve({ data: [] as { employee_id: number; field_percentage: number; field_id: number }[], error: null });

  const [{ data: homeEmployees, error: homeError }, { data: assignments, error: assignError }] =
    await Promise.all([homeEmployeesPromise, assignmentsPromise]);

  if (homeError) {
    console.error('[dashboardDepartmentCostTargets] home employees fetch failed:', homeError);
  }
  if (assignError) {
    console.error('[dashboardDepartmentCostTargets] field assignments fetch failed:', assignError);
  }

  const homeCanonicalByEmployee = new Map<number, number>();
  const homeEmployeesByCanonical = new Map<number, number[]>();

  for (const emp of homeEmployees || []) {
    const empId = Number(emp.id);
    const rawDeptId = Number(emp.department_id);
    if (!Number.isFinite(empId) || !Number.isFinite(rawDeptId)) continue;
    const canonical = canonicalByDeptId.get(rawDeptId);
    if (canonical == null || !scoreboardIdSet.has(canonical)) continue;
    homeCanonicalByEmployee.set(empId, canonical);
    const list = homeEmployeesByCanonical.get(canonical) ?? [];
    list.push(empId);
    homeEmployeesByCanonical.set(canonical, list);
  }

  type CrossSlice = { employeeId: number; percent: number };
  const commercialSlices: CrossSlice[] = [];
  const crossEmployeeIds = new Set<number>();

  if (includeCommercialFieldSlices && (assignments || []).length > 0) {
    const fieldIds = Array.from(
      new Set(
        (assignments || [])
          .map((row) => Number(row.field_id))
          .filter((id) => Number.isFinite(id) && id > 0),
      ),
    );

    const fieldDeptById = new Map<number, number>();
    if (fieldIds.length > 0) {
      const { data: fields, error: fieldsError } = await supabase
        .from('misc_maincategory')
        .select('id, department_id')
        .in('id', fieldIds);
      if (fieldsError) {
        console.error('[dashboardDepartmentCostTargets] fields fetch failed:', fieldsError);
      } else {
        for (const field of fields || []) {
          const fieldId = Number(field.id);
          const deptId = field.department_id != null ? Number(field.department_id) : NaN;
          if (Number.isFinite(fieldId) && Number.isFinite(deptId)) {
            fieldDeptById.set(fieldId, deptId);
          }
        }
      }
    }

    for (const row of assignments || []) {
      const empId = Number(row.employee_id);
      const percent = Number(row.field_percentage) || 0;
      const fieldId = Number(row.field_id);
      if (!Number.isFinite(empId) || percent <= 0 || !Number.isFinite(fieldId)) continue;

      const rawFieldDeptId = fieldDeptById.get(fieldId);
      if (rawFieldDeptId == null) continue;
      const canonicalFieldDept = canonicalByDeptId.get(rawFieldDeptId);
      if (canonicalFieldDept !== SCOREBOARD_COMMERCIAL_CIVIL_DEPT_ID) continue;

      crossEmployeeIds.add(empId);
      commercialSlices.push({ employeeId: empId, percent });
    }

    const missingHomeIds = Array.from(crossEmployeeIds).filter(
      (id) => !homeCanonicalByEmployee.has(id),
    );
    if (missingHomeIds.length > 0) {
      const { data: moreEmps, error: moreErr } = await supabase
        .from('tenants_employee')
        .select('id, department_id')
        .in('id', missingHomeIds);
      if (moreErr) {
        console.error('[dashboardDepartmentCostTargets] commercial field employee home fetch failed:', moreErr);
      } else {
        for (const emp of moreEmps || []) {
          const empId = Number(emp.id);
          const rawDeptId = emp.department_id != null ? Number(emp.department_id) : NaN;
          if (!Number.isFinite(empId) || !Number.isFinite(rawDeptId)) continue;
          const canonical = canonicalByDeptId.get(rawDeptId);
          if (canonical != null && scoreboardIdSet.has(canonical)) {
            homeCanonicalByEmployee.set(empId, canonical);
          } else {
            homeCanonicalByEmployee.set(empId, -1);
          }
        }
      }
    }
  }

  const allEmployeeIds = Array.from(
    new Set([
      ...Array.from(homeEmployeesByCanonical.values()).flat(),
      ...Array.from(crossEmployeeIds),
    ]),
  );

  const salaryMap = await fetchAverageGrossSalaryLastMonths(allEmployeeIds, 6, ref);

  for (const deptId of scoreboardIds) {
    let total = 0;
    for (const empId of homeEmployeesByCanonical.get(deptId) ?? []) {
      total += salaryMap.get(empId) ?? 0;
    }
    targets.set(deptId, total);
  }

  // Commercial & Civil: attribute field % of salary from employees assigned to its fields
  for (const slice of commercialSlices) {
    const homeCanonical = homeCanonicalByEmployee.get(slice.employeeId);
    // Skip when already fully counted as a Commercial home employee
    if (homeCanonical === SCOREBOARD_COMMERCIAL_CIVIL_DEPT_ID) continue;
    const avgGross = salaryMap.get(slice.employeeId) ?? 0;
    if (!(avgGross > 0)) continue;
    const add = (avgGross * Math.min(100, Math.max(0, slice.percent))) / 100;
    targets.set(
      SCOREBOARD_COMMERCIAL_CIVIL_DEPT_ID,
      (targets.get(SCOREBOARD_COMMERCIAL_CIVIL_DEPT_ID) ?? 0) + add,
    );
  }

  for (const [deptId, value] of targets) {
    targets.set(deptId, Math.round(value * 100) / 100);
  }

  return targets;
}

/** Apply computed cost targets onto department rows used by scoreboard builders. */
export function applyDashboardCostTargetsToDepartments<
  T extends { id: number; min_income?: unknown; cost_target?: number; name?: string },
>(departmentTargets: T[], costByDept: Map<number, number>): T[] {
  return departmentTargets.map((dept) => ({
    ...dept,
    cost_target: costByDept.get(dept.id) ?? 0,
  }));
}

/**
 * Cost base for the scoreboard "Other" column: 6-month avg gross salary of employees
 * whose home department rolls into Other (General + departments linked from Other-bucket
 * main categories), excluding departments already counted in dedicated scoreboard columns.
 */
export async function fetchDashboardOtherColumnCostTarget(
  scoreboardDepartments: ScoreboardDepartmentRef[],
  options?: {
    salesDeptIdsToExclude?: number[];
    ref?: Date;
  },
): Promise<number> {
  const ref = options?.ref ?? new Date();
  const salesDeptIdsToExclude = options?.salesDeptIdsToExclude ?? [12, 14, 15];
  const scoreboardIdSet = new Set(scoreboardDepartments.map((d) => d.id));

  const [{ data: allDepts, error: deptsError }, { data: otherMainCats, error: mainError }] =
    await Promise.all([
      supabase.from('tenant_departement').select('id, name'),
      supabase
        .from('misc_maincategory')
        .select('id, department_id')
        .in('id', Array.from(SCOREBOARD_OTHER_MAIN_CATEGORY_IDS)),
    ]);

  if (deptsError) {
    console.error('[dashboardDepartmentCostTargets] Other depts fetch failed:', deptsError);
  }
  if (mainError) {
    console.error('[dashboardDepartmentCostTargets] Other main categories fetch failed:', mainError);
  }

  const allDepartments: ScoreboardDepartmentRef[] = (allDepts || [])
    .map((dept) => ({ id: Number(dept.id), name: String(dept.name || '') }))
    .filter((dept) => Number.isFinite(dept.id));

  const canonicalByDeptId = buildScoreboardDepartmentCanonicalMap({
    scoreboardDepartments,
    allDepartments,
  });

  const otherDeptIds = new Set<number>();
  for (const id of SCOREBOARD_OTHER_DEPARTMENT_IDS) {
    otherDeptIds.add(id);
  }
  for (const row of otherMainCats || []) {
    const deptId = row.department_id != null ? Number(row.department_id) : NaN;
    if (Number.isFinite(deptId)) otherDeptIds.add(deptId);
  }

  // Drop departments already attributed to a dedicated scoreboard column (incl. sales sisters).
  for (const deptId of Array.from(otherDeptIds)) {
    if (scoreboardIdSet.has(deptId)) {
      otherDeptIds.delete(deptId);
      continue;
    }
    const canonical = canonicalByDeptId.get(deptId);
    if (canonical != null && scoreboardIdSet.has(canonical)) {
      otherDeptIds.delete(deptId);
      continue;
    }
    if (salesDeptIdsToExclude.includes(deptId)) {
      // Sales sisters only belong in Other if they do not map onto a scoreboard column.
      const salesCanonical = canonicalByDeptId.get(deptId);
      if (salesCanonical != null && scoreboardIdSet.has(salesCanonical)) {
        otherDeptIds.delete(deptId);
      }
    }
  }

  if (otherDeptIds.size === 0) return 0;

  const { data: homeEmployees, error: homeError } = await supabase
    .from('tenants_employee')
    .select('id, department_id')
    .in('department_id', Array.from(otherDeptIds));

  if (homeError) {
    console.error('[dashboardDepartmentCostTargets] Other employees fetch failed:', homeError);
    return 0;
  }

  const employeeIds = Array.from(
    new Set(
      (homeEmployees || [])
        .map((emp) => Number(emp.id))
        .filter((id) => Number.isFinite(id) && id > 0),
    ),
  );
  if (employeeIds.length === 0) return 0;

  const salaryMap = await fetchAverageGrossSalaryLastMonths(employeeIds, 6, ref);
  let total = 0;
  for (const empId of employeeIds) {
    total += salaryMap.get(empId) ?? 0;
  }
  return Math.round(total * 100) / 100;
}

/** Revenue target for Other column from its cost base (same ratio as department columns). */
export function otherScoreboardExpected(costTarget: number): number {
  return departmentScoreboardExpected({ cost_target: costTarget });
}

/**
 * Employee cost → month Target row (Agreement signed / Invoiced).
 * Cost should be at most 40% of revenue, so target = cost / 0.40.
 */
export const SCOREBOARD_COST_TO_REVENUE_RATIO = 0.4;

export function departmentScoreboardExpected(dept: {
  cost_target?: number | null;
  min_income?: unknown;
}): number {
  const cost =
    dept.cost_target != null && Number.isFinite(dept.cost_target)
      ? Math.max(0, Number(dept.cost_target))
      : Math.max(0, parseFloat(String(dept.min_income ?? '0')) || 0);
  if (!(cost > 0)) return 0;
  return Math.round((cost / SCOREBOARD_COST_TO_REVENUE_RATIO) * 100) / 100;
}
