/**
 * Monthly revenue targets per department, derived from the firm's payroll budget.
 *
 * The firm manages to a payroll-to-revenue ratio: a department's monthly revenue target is its
 * monthly payroll divided by the ratio it is aiming at. 30% is the objective, 35% an acceptable
 * intermediate, 40% the floor it must not cross. A department carrying ILS 242,630 of payroll
 * therefore needs ILS 808,767 of revenue to sit at 30%, and ILS 606,575 to sit at 40%.
 *
 * This replaces a markup model where the target was a department's payroll plus 60% of its own
 * recent revenue. That had two problems the ratio model does not: the target moved with performance,
 * so a department that billed less automatically owed less, and the ratio it actually implied was
 * 62.5% — well past the 40% ceiling it was labelled with.
 *
 * Targets are pre-VAT, matching the amounts the scoreboard measures.
 */

/** Monthly payroll budget for one firm department, and the scoreboard columns it covers. */
export type DepartmentPayrollBudget = {
  label: string;
  /** `tenant_departement` ids. More than one when the firm department spans several columns. */
  deptIds: number[];
  monthlyPayrollNis: number;
};

/**
 * The firm's monthly payroll budget, by department, in ILS.
 *
 * These are budgeted figures and deliberately not derived from the salary tables. Each one is a
 * department's own case-handling payroll plus its share of the firm's shared payroll — Marketing,
 * Development and Administration, and Accounting and Collections spread across all four departments
 * in proportion to direct payroll; general Sales spread across only the three main ones, because
 * Small Cases handles its own sales; plus one salary dedicated to Austria and Germany. They also
 * describe planned headcount rather than today's. Nothing computable from `tenants_employee`
 * reproduces them, which is why they live here: editing this list is how the dashboard gets
 * re-targeted when the payroll budget changes.
 *
 * Commercial and Israel Immigration is one department to the firm but two columns on the
 * scoreboard, so its budget covers both ids and is divided between them by
 * `allocateDepartmentPayrollBudget`.
 */
export const DEPARTMENT_PAYROLL_BUDGETS: DepartmentPayrollBudget[] = [
  { label: 'Commercial and Israel Immigration', deptIds: [20, 4], monthlyPayrollNis: 242630 },
  { label: 'Austria and Germany', deptIds: [2], monthlyPayrollNis: 217323 },
  { label: 'U.S. Immigration', deptIds: [5], monthlyPayrollNis: 76997 },
  { label: 'Small Cases', deptIds: [7], monthlyPayrollNis: 33157 },
];

/** Total monthly payroll budget across the firm, in ILS. */
export const FIRM_MONTHLY_PAYROLL_BUDGET_NIS = DEPARTMENT_PAYROLL_BUDGETS.reduce(
  (sum, budget) => sum + budget.monthlyPayrollNis,
  0,
);

export type RevenueTargetKey = 'ideal' | 'intermediate' | 'minimum';

/** The three payroll-to-revenue ratios the firm manages against, best first. */
export const REVENUE_TARGET_RATIOS: {
  key: RevenueTargetKey;
  /** Payroll as a share of revenue, so a *lower* ratio is a *higher* target. */
  ratio: number;
  label: string;
}[] = [
  { key: 'ideal', ratio: 0.3, label: 'Monthly target · 30% ideal' },
  { key: 'intermediate', ratio: 0.35, label: 'Monthly target · 35% intermediate' },
  { key: 'minimum', ratio: 0.4, label: 'Monthly target · 40% minimum' },
];

/** The ratio the goal bars measure against: the firm's primary objective. */
export const PRIMARY_REVENUE_TARGET_RATIO = 0.3;

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

/**
 * Budgeted monthly payroll per scoreboard department id.
 *
 * Departments that stand alone take their budget whole. One that spans several columns has its
 * budget divided between them in proportion to the payroll actually computed from their staff, so
 * the split tracks how the department is really staffed rather than being fixed here. The last
 * column absorbs the rounding residue, which keeps the parts summing to the budget exactly.
 *
 * A department with no measurable live payroll — no staff mapped to it yet, or salaries missing —
 * would otherwise make the proportion undefined, so the budget is divided evenly in that case. That
 * is a worse split than the proportional one but far better than leaving a column with no target.
 *
 * Any department not named in the budget is absent from the result, which leaves it without a
 * target. That is the intended treatment of the General and Other columns: they are not departments
 * the firm sets revenue goals for, so inventing one for them would be noise.
 */
export function allocateDepartmentPayrollBudget(
  livePayrollByDeptId: Map<number, number>,
): Map<number, number> {
  const budgetByDeptId = new Map<number, number>();

  for (const budget of DEPARTMENT_PAYROLL_BUDGETS) {
    const { deptIds, monthlyPayrollNis } = budget;
    if (deptIds.length === 0 || !(monthlyPayrollNis > 0)) continue;

    if (deptIds.length === 1) {
      budgetByDeptId.set(deptIds[0], monthlyPayrollNis);
      continue;
    }

    const livePayroll = deptIds.map((id) => Math.max(0, Number(livePayrollByDeptId.get(id)) || 0));
    const liveTotal = livePayroll.reduce((sum, value) => sum + value, 0);

    let allocated = 0;
    deptIds.forEach((id, index) => {
      if (index === deptIds.length - 1) {
        budgetByDeptId.set(id, round2(monthlyPayrollNis - allocated));
        return;
      }
      const share = liveTotal > 0 ? livePayroll[index] / liveTotal : 1 / deptIds.length;
      const amount = round2(monthlyPayrollNis * share);
      allocated += amount;
      budgetByDeptId.set(id, amount);
    });
  }

  return budgetByDeptId;
}

/**
 * Monthly revenue needed for payroll to be `ratio` of revenue.
 *
 * Rounded to whole shekels, because that is how the budget document states these targets and the
 * scoreboard rounds up when it prints them. Left at two decimals, four of the firm's twelve targets
 * would be shown a shekel above the agreed figure — ILS 219,992 against the document's 219,991, and
 * so on. Nobody manages to the shekel, but a dashboard that disagrees with the document it was built
 * from invites someone to go looking for a bug that is not there.
 *
 * Returns 0 rather than infinity for a department with no payroll budget, which the callers read as
 * "no target" and render as a dash.
 */
export function revenueTargetFromPayroll(monthlyPayrollNis: number, ratio: number): number {
  const payroll = Number(monthlyPayrollNis) || 0;
  if (!(payroll > 0) || !(ratio > 0)) return 0;
  return Math.round(payroll / ratio);
}

/** Sunday to Thursday — the Israeli working week. `getUTCDay()` counts Sunday as 0. */
const WORKING_WEEKDAYS = new Set([0, 1, 2, 3, 4]);

/** Parsed as UTC so a date key never shifts a day under the runner's local timezone. */
function parseDateKey(dateKey: string): Date | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(dateKey || '').trim());
  if (!match) return null;
  const parsed = new Date(
    Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])),
  );
  return Number.isFinite(parsed.getTime()) ? parsed : null;
}

function formatDateKey(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function addDays(date: Date, days: number): Date {
  const next = new Date(date.getTime());
  next.setUTCDate(next.getUTCDate() + days);
  return next;
}

export function isWorkingDay(dateKey: string): boolean {
  const date = parseDateKey(dateKey);
  return date ? WORKING_WEEKDAYS.has(date.getUTCDay()) : false;
}

/** Working days in `[fromDateKey, toDateKey]`, both ends included. */
export function countWorkingDays(fromDateKey: string, toDateKey: string): number {
  const from = parseDateKey(fromDateKey);
  const to = parseDateKey(toDateKey);
  if (!from || !to || from.getTime() > to.getTime()) return 0;

  let count = 0;
  for (let day = from; day.getTime() <= to.getTime(); day = addDays(day, 1)) {
    if (WORKING_WEEKDAYS.has(day.getUTCDay())) count += 1;
  }
  return count;
}

/** Working days in the calendar month `dateKey` falls in. */
export function workingDaysInMonthOf(dateKey: string): number {
  const date = parseDateKey(dateKey);
  if (!date) return 0;
  const year = date.getUTCFullYear();
  const month = date.getUTCMonth();
  const firstDay = new Date(Date.UTC(year, month, 1));
  const lastDay = new Date(Date.UTC(year, month + 1, 0));
  return countWorkingDays(formatDateKey(firstDay), formatDateKey(lastDay));
}

/**
 * The scoreboard periods a monthly target has to be shown against.
 *
 * `rolling-week` is the scoreboard's own window — the eight days from a week before the reference
 * day through the day itself, inclusive — rather than a calendar week.
 */
export type RevenueTargetPeriod = 'day' | 'rolling-week' | 'month';

/** How many days before the reference day the scoreboard's Week column reaches back. */
const ROLLING_WEEK_LOOKBACK_DAYS = 7;

/**
 * The share of a monthly target that applies to one scoreboard column.
 *
 * The month-scale columns take the target whole: the selected month is a month exactly, "Last 30d"
 * is one by any practical measure, and "Last 3m" is displayed as a monthly average. The short
 * columns are scaled by working days, so a single day is measured against one day's worth of the
 * month rather than against all of it.
 *
 * Friday and Saturday scale to zero, which is correct — the office is shut, so no revenue is owed —
 * and the callers draw no target at all rather than an unreachable one.
 */
export function monthlyTargetScale(period: RevenueTargetPeriod, refDateKey: string): number {
  if (period === 'month') return 1;

  const workingDaysThisMonth = workingDaysInMonthOf(refDateKey);
  if (!(workingDaysThisMonth > 0)) return 0;

  if (period === 'day') {
    return (isWorkingDay(refDateKey) ? 1 : 0) / workingDaysThisMonth;
  }

  const from = parseDateKey(refDateKey);
  if (!from) return 0;
  const windowStart = formatDateKey(addDays(from, -ROLLING_WEEK_LOOKBACK_DAYS));
  return countWorkingDays(windowStart, refDateKey) / workingDaysThisMonth;
}

/**
 * A department's revenue target for one scoreboard column.
 *
 * Kept as one call so the three places that need a target — the goal bars, the target rows and the
 * modal that explains them — cannot drift apart on either the ratio or the pro-rating.
 */
export function departmentRevenueTarget(params: {
  monthlyPayrollNis: number;
  ratio: number;
  period: RevenueTargetPeriod;
  refDateKey: string;
}): number {
  const monthlyTarget = revenueTargetFromPayroll(params.monthlyPayrollNis, params.ratio);
  if (!(monthlyTarget > 0)) return 0;
  return round2(monthlyTarget * monthlyTargetScale(params.period, params.refDateKey));
}
