import test from 'node:test';
import assert from 'node:assert/strict';

import {
  ALLOCATION_MAX_TOTAL_PERCENT,
  allocationOverflowPercent,
  formatLeadAllocationMissingDayMenuLabel,
  formatLeadAllocationMissingDayTabLabel,
  isAllocationOverAllocated,
  splitMissingAllocationDatesByWeek,
} from './employeeLeadReporting';

/** Lead rows as the allocation sliders hold them. */
function leads(...percents: number[]): { percent: number }[] {
  return percents.map((percent) => ({ percent }));
}

test('a day that adds up to exactly 100% is not over-allocated', () => {
  assert.equal(allocationOverflowPercent(leads(50, 30), 20), 0);
  assert.equal(isAllocationOverAllocated(leads(50, 30), 20), false);
  assert.equal(ALLOCATION_MAX_TOTAL_PERCENT, 100);
});

test('an under-allocated day is not blocked', () => {
  // Saving balances it up to 100%, which takes nothing away from the person.
  assert.equal(allocationOverflowPercent(leads(40, 20), 0), 0);
  assert.equal(isAllocationOverAllocated(leads(40, 20), 0), false);
});

test('an empty day is not over-allocated', () => {
  assert.equal(allocationOverflowPercent([], 0), 0);
  assert.equal(isAllocationOverAllocated([], 0), false);
});

test('the overflow is how much has to come off', () => {
  assert.equal(allocationOverflowPercent(leads(101), 0), 1);
  // The state the sliders make easy to reach: every lead left at full.
  assert.equal(allocationOverflowPercent(leads(100, 100, 100), 0), 200);
  assert.equal(isAllocationOverAllocated(leads(100, 100, 100), 0), true);
});

test('other work counts towards the maximum', () => {
  // Leads alone fit; the day still does not.
  assert.equal(allocationOverflowPercent(leads(90), 0), 0);
  assert.equal(allocationOverflowPercent(leads(90), 20), 10);
});

test('excluded rows are the caller\'s business, not the helper\'s', () => {
  /*
   * The page passes only included rows, so the helper counts everything it is handed — a row left
   * at 60% but unticked must not block a save.
   */
  assert.equal(allocationOverflowPercent(leads(60, 40), 0), 0);
});

test('a day that still reads as 100% is not refused for a fraction', () => {
  /*
   * Percentages are displayed whole. Blocking a day that shows 100% would put someone in front of
   * a refusal they cannot see the cause of, let alone fix — saving balances those away instead.
   */
  assert.equal(allocationOverflowPercent(leads(33.33, 33.33, 33.34), 0), 0);
  assert.equal(allocationOverflowPercent(leads(100.01), 0), 0);
  assert.equal(isAllocationOverAllocated(leads(60.15, 40.1), 0), false);
  assert.equal(isAllocationOverAllocated(leads(100.4), 0), false);
});

test('the overflow is a whole percent, matching what the person is shown', () => {
  // 100.5% displays as 101%, so it is refused and 1% is what has to come off.
  assert.equal(allocationOverflowPercent(leads(100.5), 0), 1);
  assert.equal(allocationOverflowPercent(leads(70.5), 30), 1);
  assert.equal(allocationOverflowPercent(leads(60.15, 40.1, 1), 0), 1);
});

test('unreadable percentages do not block a save', () => {
  /*
   * A row with no usable number is a different bug, and refusing to save a day over it would leave
   * someone stuck with no way to fix it from this screen.
   */
  assert.equal(isAllocationOverAllocated([{ percent: Number.NaN }], 0), false);
  assert.equal(isAllocationOverAllocated([{ percent: undefined as never }], 0), false);
});

// ---------------------------------------------------------------- missing reports, this week vs older

test("this week's missing days are kept in view and older ones set aside", () => {
  // Wednesday 14 Oct 2026; the week began Sunday the 11th.
  const split = splitMissingAllocationDatesByWeek(
    ['2026-10-07', '2026-10-08', '2026-10-11', '2026-10-12', '2026-10-14'],
    '2026-10-14',
  );

  assert.deepEqual(split.thisWeek, ['2026-10-11', '2026-10-12', '2026-10-14']);
  assert.deepEqual(split.earlier, ['2026-10-07', '2026-10-08']);
});

test('a week is counted from Sunday, as the work week runs Sunday to Thursday', () => {
  // Sunday itself starts the week, so it is this week and the Thursday before it is not.
  const split = splitMissingAllocationDatesByWeek(['2026-10-08', '2026-10-11'], '2026-10-11');

  assert.deepEqual(split.thisWeek, ['2026-10-11']);
  assert.deepEqual(split.earlier, ['2026-10-08']);
});

test('on a Saturday the week that is ending is still this week', () => {
  /*
   * Saturday 17 Oct closes the week that opened on Sunday the 11th, so nothing from it drops into
   * the backlog while someone can still report on it.
   */
  const split = splitMissingAllocationDatesByWeek(['2026-10-11', '2026-10-15'], '2026-10-17');

  assert.deepEqual(split.thisWeek, ['2026-10-11', '2026-10-15']);
  assert.deepEqual(split.earlier, []);
});

test('the order the days arrived in is kept', () => {
  // The strip reads oldest to newest, which is the order the catch-up happens in.
  const split = splitMissingAllocationDatesByWeek(
    ['2026-08-06', '2026-09-03', '2026-10-12', '2026-10-13'],
    '2026-10-14',
  );

  assert.deepEqual(split.earlier, ['2026-08-06', '2026-09-03']);
  assert.deepEqual(split.thisWeek, ['2026-10-12', '2026-10-13']);
});

test('nothing missing splits into nothing', () => {
  const split = splitMissingAllocationDatesByWeek([], '2026-10-14');

  assert.deepEqual(split.thisWeek, []);
  assert.deepEqual(split.earlier, []);
});

test('a whole backlog with nothing from this week leaves the strip to the dropdown alone', () => {
  const split = splitMissingAllocationDatesByWeek(['2026-09-28', '2026-10-01'], '2026-10-14');

  assert.deepEqual(split.thisWeek, []);
  assert.equal(split.earlier.length, 2);
});

// ---------------------------------------------------------------- how a missing day is named

test('today and yesterday are named on their tabs, other days are dated', () => {
  assert.equal(formatLeadAllocationMissingDayTabLabel('2026-10-14', '2026-10-14'), 'Today');
  assert.equal(formatLeadAllocationMissingDayTabLabel('2026-10-13', '2026-10-14'), 'Yesterday');
  // Anything further back keeps the short weekday and date it had before.
  assert.match(formatLeadAllocationMissingDayTabLabel('2026-10-11', '2026-10-14'), /11/);
  assert.equal(formatLeadAllocationMissingDayTabLabel('2026-10-11', '2026-10-14').includes('Yesterday'), false);
});

test('yesterday is named across a month boundary', () => {
  // The first of the month is where hand-rolled date arithmetic usually goes wrong.
  assert.equal(formatLeadAllocationMissingDayTabLabel('2026-09-30', '2026-10-01'), 'Yesterday');
  assert.equal(formatLeadAllocationMissingDayTabLabel('2026-12-31', '2027-01-01'), 'Yesterday');
});

test('the backlog menu spells the day out in full', () => {
  assert.equal(
    formatLeadAllocationMissingDayMenuLabel('2026-08-06', '2026-10-14'),
    'Thursday, 06.08.2026',
  );
  assert.equal(
    formatLeadAllocationMissingDayMenuLabel('2026-10-01', '2026-10-14'),
    'Thursday, 01.10.2026',
  );
});

test('the menu keeps the day and month padded, so the column lines up', () => {
  const label = formatLeadAllocationMissingDayMenuLabel('2026-09-03', '2026-10-14');

  assert.match(label, /03\.09\.2026$/);
});

test('today and yesterday keep their names in the menu, with the date beside them', () => {
  /*
   * Either can land in the backlog on the day a week turns over — a Sunday pushes Saturday out of
   * the current week — and a date alone would read as older than it is.
   */
  assert.equal(formatLeadAllocationMissingDayMenuLabel('2026-10-11', '2026-10-11'), 'Today, 11.10.2026');
  assert.equal(
    formatLeadAllocationMissingDayMenuLabel('2026-10-10', '2026-10-11'),
    'Yesterday, 10.10.2026',
  );
});

test('an unusable date is handed back as it came, not as a broken label', () => {
  assert.equal(formatLeadAllocationMissingDayMenuLabel('', '2026-10-14'), '');
  assert.equal(formatLeadAllocationMissingDayMenuLabel('not-a-date', '2026-10-14'), 'not-a-date');
});
