/**
 * Calculation layer for the Simple Contribution report (`SimpleContributionReportPage`).
 *
 * This is deliberately the "first type" of calculation only: every employee's Signed, Due,
 * Contribution and Contribution Fixed is derived from that employee's own leads and the
 * percentages configured for their role and department. There is no cross-contribution — nothing
 * is moved between employees, departments or fields, and no amount is taken over from another
 * table. The richer reallocation model lives in `SalesContributionPage` and stays there.
 *
 * Per-lead role maths is NOT duplicated here: it is reused from `salesContributionCalculator` so
 * the two reports cannot drift apart. What this module owns is the orchestration around it —
 * turning raw metrics into Contribution Fixed, Salary Budget and Incentives, and scaling each
 * department to its slice of invoiced income.
 */
import {
  batchCalculateEmployeeMetrics,
  type EmployeeCalculationInput,
  type EmployeeCalculationResult,
} from './salesContributionCalculator';

/** Salary Budget is 40% of (Contribution + Contribution Fixed) — shown as the "40%" sub-label. */
export const SALARY_BUDGET_RATE = 0.4;

/** Marketing / Finance / Partners take 60% of Salary (B) as their fixed contribution. */
export const MFP_FIXED_CONTRIBUTION_RATE = 0.6;

/** Departments whose fixed contribution is a share of salary rather than lead-derived. */
const MFP_DEPARTMENTS = new Set(['Marketing', 'Finance', 'Partners']);

export const roundContributionMoney = (x: number) => Math.round(x * 100) / 100;

export interface EmployeeData {
  employeeId: number;
  employeeName: string;
  department: string;
  photoUrl?: string | null;
  signed: number;
  signedNormalized: number;
  dueNormalized: number;
  signedPortion: number;
  contribution?: number;
  /** Salary-derived fixed slice (Marketing / Finance / Partners, or an explicit DB value). */
  contributionFixed?: number;
  salaryBudget: number;
  salaryBrutto: number;
  totalSalaryCost: number;
  maxIncentives: number;
  due: number;
  duePortion: number;
  total: number;
  totalPortionDue: number;
  percentOfIncome: number;
  normalized: number;
}

export interface DepartmentData {
  departmentName: string;
  employees: EmployeeData[];
  totals: {
    signed: number;
    signedNormalized: number;
    dueNormalized: number;
    signedPortion: number;
    contribution: number;
    contributionFixed: number;
    salaryBudget: number;
    salaryBrutto: number;
    totalSalaryCost: number;
    maxIncentives: number;
    due: number;
    duePortion: number;
    total: number;
    totalPortionDue: number;
    percentOfIncome: number;
    normalized: number;
  };
}

/**
 * Signed / Due / Contribution for every employee, from their own leads and payments.
 *
 * Thin pass-through to `batchCalculateEmployeeMetrics`; it exists so the report has a single
 * calculation entry point and so the no-cross-contribution rule has one place to be enforced.
 */
export function calculateSimpleEmployeeMetrics(
  inputs: EmployeeCalculationInput[]
): Map<number, EmployeeCalculationResult> {
  return batchCalculateEmployeeMetrics(inputs);
}

export interface ContributionFixedArgs {
  departmentName: string;
  /** Salary (B) — the employee's brutto/net monthly salary for the period. */
  salaryBrutto: number;
  /** `sales_contribution_use_fixed_from_db` toggle. */
  useFixedFromDb: boolean;
  /** Value from `employee_fixed_contribution`, or undefined when the employee has no row. */
  fixedFromDb?: number;
  /** True when the employee has a fixed-contribution field assignment (Marketing/Finance/Partners role). */
  hasFixedContributionAssignment: boolean;
}

/**
 * Contribution Fixed for one employee.
 *
 * With the DB toggle on, only employees with an `employee_fixed_contribution` row get a fixed
 * amount and it is used verbatim. With it off, Marketing / Finance / Partners get 60% of Salary
 * (B), employees flagged by a field assignment get 100%, and everyone else gets nothing.
 */
export function resolveContributionFixed({
  departmentName,
  salaryBrutto,
  useFixedFromDb,
  fixedFromDb,
  hasFixedContributionAssignment,
}: ContributionFixedArgs): number {
  if (useFixedFromDb) {
    return fixedFromDb ?? 0;
  }
  const salaryB = salaryBrutto || 0;
  if (MFP_DEPARTMENTS.has(departmentName)) {
    return salaryB * MFP_FIXED_CONTRIBUTION_RATE;
  }
  if (hasFixedContributionAssignment) {
    return salaryB;
  }
  return 0;
}

export function computeSalaryBudget(contribution: number, contributionFixed: number): number {
  return ((contribution || 0) + (contributionFixed || 0)) * SALARY_BUDGET_RATE;
}

export function computeMaxIncentives(salaryBudget: number, totalSalaryCost: number): number {
  return (salaryBudget ?? 0) - (totalSalaryCost ?? 0);
}

/** Recompute a department's totals from its (already final) employee rows. */
export function recomputeDepartmentTotals(deptData: DepartmentData): DepartmentData {
  const { employees } = deptData;
  const sum = (pick: (emp: EmployeeData) => number) =>
    employees.reduce((acc, emp) => acc + (pick(emp) || 0), 0);

  return {
    ...deptData,
    totals: {
      ...deptData.totals,
      signed: sum((e) => e.signed),
      due: sum((e) => e.due),
      signedNormalized: sum((e) => e.signedNormalized),
      dueNormalized: sum((e) => e.dueNormalized),
      signedPortion: sum((e) => e.signedPortion),
      contribution: sum((e) => e.contribution ?? 0),
      contributionFixed: sum((e) => e.contributionFixed ?? 0),
      salaryBudget: sum((e) => e.salaryBudget),
      salaryBrutto: sum((e) => e.salaryBrutto),
      totalSalaryCost: sum((e) => e.totalSalaryCost),
      maxIncentives: sum((e) => e.maxIncentives ?? 0),
    },
  };
}

/**
 * Scale each department so its table reconciles with its slice of invoiced income, then derive
 * Salary Budget from the scaled amounts.
 *
 * Per department d: Σ (contribution + contributionFixed) = totalInvoicedIncome × (saved % for d / 100).
 * When the department percentages sum to 100%, the whole report sums to invoiced income and each
 * department's salary budget is 40% of its slice — which is what the summary cards display.
 *
 * Scaling is proportional within a department, so it does not move money between employees: it is
 * the same multiplier for everyone in the table. The only exception is the sub-agora rounding
 * drift, which is parked on the largest row so the totals are exact.
 *
 * A department with a slice but nothing to scale — no contribution and no fixed contribution on
 * any row — has its slice split evenly across its employees as fixed contribution, so the slice
 * stays in the report. Only a department with no employees at all forfeits it.
 */
export function scaleDepartmentsToInvoicedIncome(
  prev: Map<string, DepartmentData>,
  totalInvoicedIncome: number,
  departmentPercentages: Map<string, number>
): Map<string, DepartmentData> {
  if (!prev.size || totalInvoicedIncome <= 0) return prev;

  const byEmployeeId = new Map<number, { c: number; f: number }>();
  const deptSkipDrift = new Set<string>();

  prev.forEach((dept, deptName) => {
    const pct = departmentPercentages.get(deptName) ?? 0;
    const targetBasis = roundContributionMoney((totalInvoicedIncome * pct) / 100);
    let rawBasis = 0;
    dept.employees.forEach((emp) => {
      rawBasis += (emp.contribution ?? 0) + (emp.contributionFixed ?? 0);
    });
    if (rawBasis <= 0) {
      // A department can own a slice of income with nothing to scale it onto — Marketing, whose
      // fixed contribution is a share of Salary (B), reads zero until those salaries are entered.
      // Split the slice evenly as fixed contribution rather than dropping it: discarding it was
      // what made the report total come up short of Total income.
      const headcount = dept.employees.length;
      if (targetBasis > 0 && headcount > 0) {
        const share = roundContributionMoney(targetBasis / headcount);
        let remaining = targetBasis;
        dept.employees.forEach((emp, index) => {
          // The last row absorbs the rounding residue so the department lands exactly on target.
          const f = index === headcount - 1 ? roundContributionMoney(remaining) : share;
          remaining = roundContributionMoney(remaining - f);
          byEmployeeId.set(emp.employeeId, { c: 0, f });
        });
        return;
      }

      dept.employees.forEach((emp) => {
        byEmployeeId.set(emp.employeeId, { c: 0, f: 0 });
      });
      // Nobody to park the slice on, so the drift pass must not try either.
      if (targetBasis > 0) {
        deptSkipDrift.add(deptName);
      }
      return;
    }
    const k = targetBasis / rawBasis;
    dept.employees.forEach((emp) => {
      const c = emp.contribution ?? 0;
      const f = emp.contributionFixed ?? 0;
      byEmployeeId.set(emp.employeeId, {
        c: roundContributionMoney(c * k),
        f: roundContributionMoney(f * k),
      });
    });
  });

  // Park each department's rounding drift on its largest row so the table total is exact.
  prev.forEach((dept, deptName) => {
    const pct = departmentPercentages.get(deptName) ?? 0;
    const targetBasis = roundContributionMoney((totalInvoicedIncome * pct) / 100);
    if (dept.employees.length === 0) return;
    let sumInDept = 0;
    const idsInDept: number[] = [];
    dept.employees.forEach((emp) => {
      const v = byEmployeeId.get(emp.employeeId);
      if (v) {
        sumInDept += v.c + v.f;
        idsInDept.push(emp.employeeId);
      }
    });
    if (deptSkipDrift.has(deptName)) return;
    const drift = roundContributionMoney(targetBasis - sumInDept);
    if (Math.abs(drift) < 0.005 || idsInDept.length === 0) return;
    idsInDept.sort((a, b) => a - b);
    let maxId = -1;
    let maxB = -1;
    for (const id of idsInDept) {
      const v = byEmployeeId.get(id)!;
      const b = v.c + v.f;
      if (b > maxB || (b === maxB && (maxId < 0 || id < maxId))) {
        maxB = b;
        maxId = id;
      }
    }
    if (maxId >= 0) {
      const v = byEmployeeId.get(maxId)!;
      v.c = roundContributionMoney(v.c + drift);
      if (v.c < 0) {
        v.f = roundContributionMoney(v.f + v.c);
        v.c = 0;
      }
    }
  });

  const salaryByEmployeeId = new Map<number, number>();
  byEmployeeId.forEach((v, id) => {
    salaryByEmployeeId.set(id, roundContributionMoney(computeSalaryBudget(v.c, v.f)));
  });

  // Same treatment for the salary budget column: absorb rounding drift on the largest row.
  //
  // Target 40% of what was actually allocated, not 40% of raw income. When the department
  // percentages do not reach 100%, those differ by real money, and this step would dump the whole
  // difference onto one employee's salary budget as if it were a rounding error.
  let allocatedBasis = 0;
  byEmployeeId.forEach((v) => {
    allocatedBasis += v.c + v.f;
  });
  const targetTotalSalaryBudget = roundContributionMoney(allocatedBasis * SALARY_BUDGET_RATE);
  let sumSalaryBudget = 0;
  salaryByEmployeeId.forEach((sb) => {
    sumSalaryBudget += sb;
  });
  const salaryBudgetDrift = roundContributionMoney(targetTotalSalaryBudget - sumSalaryBudget);
  if (Math.abs(salaryBudgetDrift) >= 0.005 && salaryByEmployeeId.size > 0) {
    let maxSalaryId = -1;
    let maxSalaryVal = -1;
    const sortedSalaryIds = Array.from(salaryByEmployeeId.keys()).sort((a, b) => a - b);
    for (const id of sortedSalaryIds) {
      const sb = salaryByEmployeeId.get(id) ?? 0;
      if (sb > maxSalaryVal || (sb === maxSalaryVal && (maxSalaryId < 0 || id < maxSalaryId))) {
        maxSalaryVal = sb;
        maxSalaryId = id;
      }
    }
    if (maxSalaryId >= 0) {
      salaryByEmployeeId.set(
        maxSalaryId,
        roundContributionMoney((salaryByEmployeeId.get(maxSalaryId) ?? 0) + salaryBudgetDrift)
      );
    }
  }

  const next = new Map<string, DepartmentData>();
  prev.forEach((deptData, deptName) => {
    const employees = deptData.employees.map((emp) => {
      const scaled = byEmployeeId.get(emp.employeeId);
      if (!scaled) return emp;
      const contribution = scaled.c;
      const contributionFixed = scaled.f;
      const salaryBudget =
        salaryByEmployeeId.get(emp.employeeId) ??
        roundContributionMoney(computeSalaryBudget(contribution, contributionFixed));
      return {
        ...emp,
        contribution,
        contributionFixed,
        salaryBudget,
        maxIncentives: computeMaxIncentives(salaryBudget, emp.totalSalaryCost ?? 0),
      };
    });

    next.set(deptName, recomputeDepartmentTotals({ ...deptData, employees }));
  });

  return next;
}
