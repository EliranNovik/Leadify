import { supabase } from './supabase';
import { fetchAverageGrossSalaryLastMonths } from './employeeSalaries';
import {
  GOAL_BAR_REVENUE_TARGET_RATIO,
  revenueTargetFromPayroll,
} from './dashboardRevenueTargets';
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

/** Scoreboard column for Commercial & Civil (often no home employees — relies on field %). */
export const SCOREBOARD_COMMERCIAL_CIVIL_DEPT_ID = 20;

const SCOREBOARD_HANDLERS_SALES_ROLES = new Set(['Sales', 'Handlers']);
const SCOREBOARD_OVERHEAD_ROLES = new Set(['Partners', 'Marketing', 'Finance']);
const SCOREBOARD_COST_ROLES = ['Sales', 'Handlers', 'Partners', 'Marketing', 'Finance'] as const;

function isEmployeeFiredFlag(value: unknown): boolean {
  return value === true || value === 'true' || value === 1 || value === '1';
}

/** Employees with `fired = true` are excluded from Agreement signed / Invoiced cost targets. */
async function fetchFiredEmployeeIdSet(employeeIds: number[]): Promise<Set<number>> {
  const fired = new Set<number>();
  if (employeeIds.length === 0) return fired;

  const { data, error } = await supabase
    .from('tenants_employee')
    .select('id, fired')
    .in('id', employeeIds);

  if (error) {
    console.error('[dashboardDepartmentCostTargets] fired employees fetch failed:', error);
    return fired;
  }

  for (const row of data || []) {
    if (!isEmployeeFiredFlag(row.fired)) continue;
    const id = Number(row.id);
    if (Number.isFinite(id) && id > 0) fired.add(id);
  }
  return fired;
}

function assignmentSliceKey(employeeId: number, fieldId: number, role: string): string {
  return `${employeeId}:${fieldId}:${role}`;
}

export type DashboardDeptCostBreakdown = {
  total: number;
  handlersSales: number;
  partnersMarketingFinance: number;
};

export type DashboardDepartmentCostTargetsResult = {
  totals: Map<number, number>;
  breakdownByDeptId: Map<number, DashboardDeptCostBreakdown>;
};

/**
 * Monthly cost base per scoreboard column (Agreement Signed / Invoiced targets).
 *
 * Mirrors Sales Contribution field attribution:
 * 1) Handlers & Sales — active assignments (+ `employee_handlers_sales_contributions`
 *    when present). Effective % prefers handlers_sales_percentage, else field_percentage.
 * 2) Partners, Marketing & Finance — active assignments; use field_percentage of full
 *    salary onto the field’s department.
 *
 * Each slice: (effective% / 100) × 6-month avg gross, mapped
 * field → misc_maincategory.department_id → scoreboard column.
 * No home-department remainder — only contribution-role field costs.
 * Employees with `tenants_employee.fired = true` are excluded from cost.
 */
export async function fetchDashboardDepartmentCostTargets(
  scoreboardDepartments: ScoreboardDepartmentRef[],
  options?: {
    salesDeptIdsToExclude?: number[];
    ref?: Date;
  },
): Promise<DashboardDepartmentCostTargetsResult> {
  const ref = options?.ref ?? new Date();
  const salesDeptIdsToExclude = options?.salesDeptIdsToExclude ?? [12, 14, 15];
  const scoreboardIds = scoreboardDepartments.map((d) => d.id);

  const totals = new Map<number, number>();
  const handlersSalesByDept = new Map<number, number>();
  const overheadByDept = new Map<number, number>();
  for (const id of scoreboardIds) {
    totals.set(id, 0);
    handlersSalesByDept.set(id, 0);
    overheadByDept.set(id, 0);
  }
  const emptyResult = (): DashboardDepartmentCostTargetsResult => ({
    totals,
    breakdownByDeptId: new Map(
      scoreboardIds.map((id) => [
        id,
        { total: 0, handlersSales: 0, partnersMarketingFinance: 0 },
      ]),
    ),
  });
  if (scoreboardIds.length === 0) return emptyResult();

  const scoreboardIdSet = new Set(scoreboardIds);

  const relatedIdSet = new Set<number>([...scoreboardIds, ...salesDeptIdsToExclude]);

  const [
    { data: relatedDepts, error: relatedError },
    { data: allDeptsByName, error: byNameError },
    { data: assignments, error: assignError },
    { data: handlersSalesRows, error: hsError },
  ] = await Promise.all([
    supabase.from('tenant_departement').select('id, name').in('id', Array.from(relatedIdSet)),
    supabase.from('tenant_departement').select('id, name'),
    supabase
      .from('employee_field_assignments')
      .select('employee_id, field_percentage, field_id, department_role')
      .eq('is_active', true)
      .in('department_role', [...SCOREBOARD_COST_ROLES]),
    supabase
      .from('employee_handlers_sales_contributions')
      .select('employee_id, field_id, handlers_sales_percentage, department_role')
      .eq('is_active', true)
      .in('department_role', ['Sales', 'Handlers']),
  ]);

  if (relatedError) {
    console.error('[dashboardDepartmentCostTargets] related departments fetch failed:', relatedError);
  }
  if (byNameError) {
    console.error('[dashboardDepartmentCostTargets] all departments fetch failed:', byNameError);
  }
  if (assignError) {
    console.error('[dashboardDepartmentCostTargets] field assignments fetch failed:', assignError);
  }
  if (hsError) {
    console.error('[dashboardDepartmentCostTargets] handlers/sales contributions fetch failed:', hsError);
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

  const handlersSalesPctByKey = new Map<string, number>();
  for (const row of handlersSalesRows || []) {
    const empId = Number(row.employee_id);
    const fieldId = Number(row.field_id);
    const role = String(row.department_role || '');
    const pct = Number(row.handlers_sales_percentage) || 0;
    if (!Number.isFinite(empId) || !Number.isFinite(fieldId) || pct <= 0) continue;
    if (!SCOREBOARD_HANDLERS_SALES_ROLES.has(role)) continue;
    const key = assignmentSliceKey(empId, fieldId, role);
    const prev = handlersSalesPctByKey.get(key) ?? 0;
    if (pct > prev) handlersSalesPctByKey.set(key, Math.min(100, pct));
  }

  type RawSlice = {
    employeeId: number;
    fieldId: number;
    role: string;
    percent: number;
    bucket: 'handlersSales' | 'overhead';
  };
  const rawByKey = new Map<string, RawSlice>();

  for (const row of assignments || []) {
    const empId = Number(row.employee_id);
    const fieldId = Number(row.field_id);
    const role = String(row.department_role || '');
    const fieldPct = Number(row.field_percentage) || 0;
    if (!Number.isFinite(empId) || !Number.isFinite(fieldId) || fieldId <= 0) continue;
    if (!SCOREBOARD_HANDLERS_SALES_ROLES.has(role) && !SCOREBOARD_OVERHEAD_ROLES.has(role)) continue;

    let percent = 0;
    const bucket: 'handlersSales' | 'overhead' = SCOREBOARD_HANDLERS_SALES_ROLES.has(role)
      ? 'handlersSales'
      : 'overhead';
    if (bucket === 'handlersSales') {
      const hs = handlersSalesPctByKey.get(assignmentSliceKey(empId, fieldId, role)) ?? 0;
      percent = hs > 0 ? hs : fieldPct;
    } else {
      percent = fieldPct;
    }
    if (!(percent > 0)) continue;

    const key = assignmentSliceKey(empId, fieldId, role);
    const prev = rawByKey.get(key);
    if (!prev || percent > prev.percent) {
      rawByKey.set(key, {
        employeeId: empId,
        fieldId,
        role,
        percent: Math.min(100, percent),
        bucket,
      });
    }
  }

  for (const [key, hsPct] of handlersSalesPctByKey) {
    if (rawByKey.has(key)) continue;
    const [empStr, fieldStr, role] = key.split(':');
    const empId = Number(empStr);
    const fieldId = Number(fieldStr);
    if (!Number.isFinite(empId) || !Number.isFinite(fieldId) || !role) continue;
    rawByKey.set(key, {
      employeeId: empId,
      fieldId,
      role,
      percent: hsPct,
      bucket: 'handlersSales',
    });
  }

  if (rawByKey.size === 0) return emptyResult();

  const fieldIds = Array.from(new Set(Array.from(rawByKey.values()).map((s) => s.fieldId)));
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

  type FieldSlice = {
    employeeId: number;
    canonicalDeptId: number;
    percent: number;
    bucket: 'handlersSales' | 'overhead';
  };
  const fieldSlices: FieldSlice[] = [];
  const employeeIds = new Set<number>();

  for (const slice of rawByKey.values()) {
    const rawFieldDeptId = fieldDeptById.get(slice.fieldId);
    if (rawFieldDeptId == null) continue;
    const canonical = canonicalByDeptId.get(rawFieldDeptId);
    if (canonical == null || !scoreboardIdSet.has(canonical)) continue;
    employeeIds.add(slice.employeeId);
    fieldSlices.push({
      employeeId: slice.employeeId,
      canonicalDeptId: canonical,
      percent: slice.percent,
      bucket: slice.bucket,
    });
  }

  if (fieldSlices.length === 0) return emptyResult();

  const employeeIdList = Array.from(employeeIds);
  const firedEmployeeIds = await fetchFiredEmployeeIdSet(employeeIdList);
  const activeFieldSlices =
    firedEmployeeIds.size === 0
      ? fieldSlices
      : fieldSlices.filter((slice) => !firedEmployeeIds.has(slice.employeeId));

  if (activeFieldSlices.length === 0) return emptyResult();

  const activeEmployeeIds = Array.from(new Set(activeFieldSlices.map((s) => s.employeeId)));
  const salaryMap = await fetchAverageGrossSalaryLastMonths(activeEmployeeIds, 6, ref);

  const slicesByEmployee = new Map<number, FieldSlice[]>();
  for (const slice of activeFieldSlices) {
    const list = slicesByEmployee.get(slice.employeeId) ?? [];
    list.push(slice);
    slicesByEmployee.set(slice.employeeId, list);
  }

  const addBucket = (
    deptId: number,
    bucket: 'handlersSales' | 'overhead',
    amount: number,
  ) => {
    totals.set(deptId, (totals.get(deptId) ?? 0) + amount);
    if (bucket === 'handlersSales') {
      handlersSalesByDept.set(deptId, (handlersSalesByDept.get(deptId) ?? 0) + amount);
    } else {
      overheadByDept.set(deptId, (overheadByDept.get(deptId) ?? 0) + amount);
    }
  };

  for (const [empId, slices] of slicesByEmployee) {
    const avgGross = salaryMap.get(empId) ?? 0;
    if (!(avgGross > 0)) continue;
    const rawSum = slices.reduce((s, row) => s + row.percent, 0);
    const scale = rawSum > 100 ? 100 / rawSum : 1;
    for (const slice of slices) {
      const pct = slice.percent * scale;
      addBucket(slice.canonicalDeptId, slice.bucket, (avgGross * pct) / 100);
    }
  }

  const breakdownByDeptId = new Map<number, DashboardDeptCostBreakdown>();
  for (const id of scoreboardIds) {
    const handlersSales = Math.round((handlersSalesByDept.get(id) ?? 0) * 100) / 100;
    const partnersMarketingFinance = Math.round((overheadByDept.get(id) ?? 0) * 100) / 100;
    const total = Math.round((handlersSales + partnersMarketingFinance) * 100) / 100;
    totals.set(id, total);
    breakdownByDeptId.set(id, { total, handlersSales, partnersMarketingFinance });
  }

  return { totals, breakdownByDeptId };
}

/**
 * Apply the payroll figure that each department's revenue target is derived from.
 *
 * Pass `allocateDepartmentPayrollBudget(...)` of the live totals rather than the live totals
 * themselves: the targets are set against the firm's budgeted payroll, and the live figures only
 * decide how a budget shared by two scoreboard columns is divided between them.
 *
 * A department absent from the map gets 0, which `departmentScoreboardExpected` reads as "no
 * target". Note that this deliberately shadows `min_income`, a stale column that still holds
 * target-shaped numbers from an older model.
 */
export function applyDashboardCostTargetsToDepartments<
  T extends { id: number; min_income?: unknown; cost_target?: number; name?: string },
>(departmentTargets: T[], payrollByDept: Map<number, number>): T[] {
  return departmentTargets.map((dept) => ({
    ...dept,
    cost_target: payrollByDept.get(dept.id) ?? 0,
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
    .select('id, department_id, fired')
    .in('department_id', Array.from(otherDeptIds));

  if (homeError) {
    console.error('[dashboardDepartmentCostTargets] Other employees fetch failed:', homeError);
    return 0;
  }

  const employeeIds = Array.from(
    new Set(
      (homeEmployees || [])
        .filter((emp) => !isEmployeeFiredFlag(emp.fired))
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

/**
 * Monthly payroll a scoreboard column's revenue target is set against.
 *
 * This is the budgeted figure once `applyDashboardCostTargetsToDepartments` has been called, not the
 * live payroll computed above. `min_income` remains only as a fallback for a department that was
 * never passed through that call.
 */
export function departmentScoreboardCostBase(dept: {
  cost_target?: number | null;
  min_income?: unknown;
}): number {
  if (dept.cost_target != null && Number.isFinite(dept.cost_target)) {
    return Math.max(0, Number(dept.cost_target));
  }
  return Math.max(0, parseFloat(String(dept.min_income ?? '0')) || 0);
}

/**
 * Revenue target for the "Other" column.
 *
 * Always 0: Other is a bucket for departments the firm sets no revenue goal for, so there is no
 * payroll budget to divide and nothing to hold it to. Kept as a function because the scoreboard
 * still carries an Other column and the shape of the call documents the decision.
 */
export function otherScoreboardExpected(_costTarget: number): number {
  return 0;
}

/**
 * A department's monthly revenue target: its payroll budget at the ratio the goal bars measure
 * against, which is the 40% floor.
 *
 * Only that one ratio belongs here, because this feeds the single figure the bars are drawn from.
 * The full set of 30 / 35 / 40% targets is built by the scoreboard from `REVENUE_TARGET_RATIOS`.
 */
export function departmentScoreboardExpected(dept: {
  cost_target?: number | null;
  min_income?: unknown;
}): number {
  return revenueTargetFromPayroll(
    departmentScoreboardCostBase(dept),
    GOAL_BAR_REVENUE_TARGET_RATIO,
  );
}
