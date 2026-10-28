import assert from 'node:assert/strict';
import test from 'node:test';

import {
  allocateDepartmentPayrollBudget,
  countWorkingDays,
  departmentRevenueTarget,
  DEPARTMENT_PAYROLL_BUDGETS,
  FIRM_MONTHLY_PAYROLL_BUDGET_NIS,
  isWorkingDay,
  monthlyTargetScale,
  GOAL_BAR_REVENUE_TARGET_RATIO,
  REVENUE_TARGET_RATIOS,
  revenueTargetFromPayroll,
  workingDaysInMonthOf,
} from './dashboardRevenueTargets';

/**
 * The firm's budget document, which is the source these constants were transcribed from.
 *
 * Every target below is checked against the figure the document states, so a typo in the budget is
 * caught here rather than by someone noticing the dashboard asks a department for the wrong number.
 */
const DOCUMENT = [
  { label: 'Commercial and Israel Immigration', payroll: 242630, ideal: 808767, mid: 693229, min: 606575 },
  { label: 'Austria and Germany', payroll: 217323, ideal: 724410, mid: 620923, min: 543308 },
  { label: 'U.S. Immigration', payroll: 76997, ideal: 256657, mid: 219991, min: 192493 },
  { label: 'Small Cases', payroll: 33157, ideal: 110523, mid: 94734, min: 82893 },
];

test('the budget matches the firm document, department by department', () => {
  assert.equal(DEPARTMENT_PAYROLL_BUDGETS.length, DOCUMENT.length);
  for (const expected of DOCUMENT) {
    const budget = DEPARTMENT_PAYROLL_BUDGETS.find((entry) => entry.label === expected.label);
    assert.ok(budget, `${expected.label} is missing from the budget`);
    assert.equal(budget.monthlyPayrollNis, expected.payroll);
  }
});

test('firm payroll totals the document figure', () => {
  assert.equal(FIRM_MONTHLY_PAYROLL_BUDGET_NIS, 570107);
});

test('each ratio produces the revenue target the document states', () => {
  for (const { label, payroll, ideal, mid, min } of DOCUMENT) {
    assert.equal(revenueTargetFromPayroll(payroll, 0.3), ideal, `${label} at 30%`);
    assert.equal(revenueTargetFromPayroll(payroll, 0.35), mid, `${label} at 35%`);
    assert.equal(revenueTargetFromPayroll(payroll, 0.4), min, `${label} at 40%`);
  }
});

test('firm-wide targets match the document', () => {
  const payroll = FIRM_MONTHLY_PAYROLL_BUDGET_NIS;
  assert.equal(revenueTargetFromPayroll(payroll, 0.3), 1900357);
  /*
   * The document states 1,628,879 and 1,425,269 for these two. Both are rounding artefacts of
   * summing the per-department figures rather than dividing the firm's payroll, so the correct
   * values are two and one shekel lower. Pinned here so the discrepancy is on the record and nobody
   * "fixes" the arithmetic back to the document.
   */
  assert.equal(revenueTargetFromPayroll(payroll, 0.35), 1628877);
  assert.equal(revenueTargetFromPayroll(payroll, 0.4), 1425268);
});

test('a lower ratio is a higher target, and the ratios are ordered best first', () => {
  const targets = REVENUE_TARGET_RATIOS.map((row) => revenueTargetFromPayroll(100000, row.ratio));
  for (let i = 1; i < targets.length; i += 1) {
    assert.ok(targets[i] < targets[i - 1], `target ${i} should be below target ${i - 1}`);
  }
  assert.deepEqual(
    REVENUE_TARGET_RATIOS.map((row) => row.key),
    ['ideal', 'intermediate', 'minimum'],
  );
});

test('the goal bars measure against the floor, which is the lowest of the three targets', () => {
  assert.ok(REVENUE_TARGET_RATIOS.some((row) => row.ratio === GOAL_BAR_REVENUE_TARGET_RATIO));
  const minimum = REVENUE_TARGET_RATIOS.find((row) => row.key === 'minimum');
  assert.equal(GOAL_BAR_REVENUE_TARGET_RATIO, minimum?.ratio);
  const barTarget = revenueTargetFromPayroll(100000, GOAL_BAR_REVENUE_TARGET_RATIO);
  for (const row of REVENUE_TARGET_RATIOS) {
    assert.ok(
      revenueTargetFromPayroll(100000, row.ratio) >= barTarget,
      `${row.key} should not be below the target the bars measure`,
    );
  }
});

test('no payroll means no target rather than an infinite one', () => {
  for (const payroll of [0, -1, Number.NaN]) {
    assert.equal(revenueTargetFromPayroll(payroll, 0.3), 0, `payroll ${payroll}`);
  }
  assert.equal(revenueTargetFromPayroll(100000, 0), 0);
});

test('a department covering one column takes its whole budget', () => {
  const allocated = allocateDepartmentPayrollBudget(new Map());
  assert.equal(allocated.get(2), 217323);
  assert.equal(allocated.get(5), 76997);
  assert.equal(allocated.get(7), 33157);
});

test('a department spanning two columns splits by their live payroll', () => {
  // Commercial & Civil (20) staffed three times as heavily as Immigration to Israel (4).
  const allocated = allocateDepartmentPayrollBudget(new Map([[20, 90000], [4, 30000]]));
  assert.equal(allocated.get(20), 181972.5);
  assert.equal(allocated.get(4), 60657.5);
  assert.equal((allocated.get(20) ?? 0) + (allocated.get(4) ?? 0), 242630);
});

test('the split always sums back to the budget, whatever the proportions', () => {
  const splits: [number, number][] = [
    [1, 2],
    [33333, 66667],
    [0.01, 242629.99],
    [7, 7],
    [1000000, 1],
  ];
  for (const [commercial, israel] of splits) {
    const allocated = allocateDepartmentPayrollBudget(
      new Map([[20, commercial], [4, israel]]),
    );
    const sum = (allocated.get(20) ?? 0) + (allocated.get(4) ?? 0);
    assert.equal(sum, 242630, `split ${commercial}/${israel} summed to ${sum}`);
  }
});

test('a spanning department with no live payroll splits evenly rather than losing its target', () => {
  for (const live of [new Map<number, number>(), new Map([[20, 0], [4, 0]])]) {
    const allocated = allocateDepartmentPayrollBudget(live);
    assert.equal(allocated.get(20), 121315);
    assert.equal(allocated.get(4), 121315);
  }
});

test('departments outside the budget get no target', () => {
  const allocated = allocateDepartmentPayrollBudget(new Map([[1, 50000], [3, 20000]]));
  // General (1) and Poland (3) are not departments the firm sets revenue goals for.
  assert.equal(allocated.has(1), false);
  assert.equal(allocated.has(3), false);
});

test('the working week runs Sunday to Thursday', () => {
  // 2026-10-11 is a Sunday.
  const week = [
    ['2026-10-11', true], // Sunday
    ['2026-10-12', true], // Monday
    ['2026-10-13', true], // Tuesday
    ['2026-10-14', true], // Wednesday
    ['2026-10-15', true], // Thursday
    ['2026-10-16', false], // Friday
    ['2026-10-17', false], // Saturday
  ] as const;
  for (const [dateKey, working] of week) {
    assert.equal(isWorkingDay(dateKey), working, dateKey);
  }
});

test('working days are counted inclusively at both ends', () => {
  assert.equal(countWorkingDays('2026-10-11', '2026-10-11'), 1);
  assert.equal(countWorkingDays('2026-10-11', '2026-10-17'), 5);
  assert.equal(countWorkingDays('2026-10-16', '2026-10-17'), 0);
  // Backwards ranges and unreadable keys are no range at all.
  assert.equal(countWorkingDays('2026-10-17', '2026-10-11'), 0);
  assert.equal(countWorkingDays('', '2026-10-11'), 0);
});

test('October 2026 has 21 working days', () => {
  // Thursday the 1st, then four full Sunday-to-Thursday weeks, then a Friday and Saturday to close.
  assert.equal(workingDaysInMonthOf('2026-10-11'), 21);
});

test('month-scale columns take the whole monthly target', () => {
  assert.equal(monthlyTargetScale('month', '2026-10-11'), 1);
});

test('a single working day is scaled to one day of the month', () => {
  assert.equal(monthlyTargetScale('day', '2026-10-11'), 1 / 21);
});

test('a closed day owes nothing', () => {
  assert.equal(monthlyTargetScale('day', '2026-10-16'), 0); // Friday
  assert.equal(monthlyTargetScale('day', '2026-10-17'), 0); // Saturday
});

test('the rolling week is scaled by the working days actually in its window', () => {
  // The scoreboard's Week column spans 2026-10-11..2026-10-18 inclusive: Sun-Thu plus the next Sun.
  assert.equal(countWorkingDays('2026-10-11', '2026-10-18'), 6);
  assert.equal(monthlyTargetScale('rolling-week', '2026-10-18'), 6 / 21);
});

test('pro-rated targets stay under the monthly target and add up over a month', () => {
  const payroll = 242630;
  const monthly = revenueTargetFromPayroll(payroll, GOAL_BAR_REVENUE_TARGET_RATIO);
  const day = departmentRevenueTarget({
    monthlyPayrollNis: payroll,
    ratio: GOAL_BAR_REVENUE_TARGET_RATIO,
    period: 'day',
    refDateKey: '2026-10-11',
  });
  assert.ok(day > 0 && day < monthly);
  // 21 working days of October at one day's target each is the month's target back again.
  assert.equal(Math.round(day * 21), monthly);
});

test('an unreadable date leaves the short columns without a target', () => {
  for (const period of ['day', 'rolling-week'] as const) {
    assert.equal(monthlyTargetScale(period, 'not-a-date'), 0, period);
    assert.equal(
      departmentRevenueTarget({
        monthlyPayrollNis: 242630,
        ratio: 0.3,
        period,
        refDateKey: '',
      }),
      0,
      period,
    );
  }
});
