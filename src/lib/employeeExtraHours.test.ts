import assert from 'node:assert/strict';
import test from 'node:test';

import {
  DEFAULT_DAILY_MIN_HOURS,
  calculateEmployeeExtraHours,
} from './employeeExtraHours';
import type { ClockInExportRecord } from './workingHoursExport';

const MS_PER_HOUR = 3_600_000;
const NO_HOLIDAYS = new Map<string, string[]>();
const NOW = Date.parse('2026-09-01T12:00:00+03:00');

const MONDAY = '2026-08-10';
const SATURDAY = '2026-08-08';

/** August is IDT, so the offset is fixed and the test is timezone-independent. */
function shift(date: string, from: string, to: string): ClockInExportRecord {
  return {
    clock_in_time: `${date}T${from}:00+03:00`,
    clock_out_time: `${date}T${to}:00+03:00`,
    notes: null,
    manually: false,
  };
}

function totalsForDay(date: string, from: string, to: string, minHours = 8) {
  const result = calculateEmployeeExtraHours(
    [shift(date, from, to)],
    minHours,
    NO_HOLIDAYS,
    date,
    date,
    [],
    NOW,
  );
  const hours = (ms: number) => Math.round((ms / MS_PER_HOUR) * 10_000) / 10_000;
  return {
    extra125: hours(result.extraHours125Ms),
    extra150: hours(result.extraHours150Ms),
    deficit: hours(result.deficitHoursMs),
    base: hours(result.baseHoursMs),
  };
}

test('overtime starts the moment min_hours is passed', () => {
  assert.equal(DEFAULT_DAILY_MIN_HOURS, 8);

  // Exactly the 8 owed: nothing extra, nothing missing.
  assert.deepEqual(totalsForDay(MONDAY, '08:00', '16:00'), {
    extra125: 0,
    extra150: 0,
    deficit: 0,
    base: 8,
  });

  assert.deepEqual(totalsForDay(MONDAY, '08:00', '17:00'), {
    extra125: 1,
    extra150: 0,
    deficit: 0,
    base: 8,
  });
});

test('the first two overtime hours pay 125%, the rest 150%', () => {
  // 10h on an 8h contract = the full 125% band.
  assert.deepEqual(totalsForDay(MONDAY, '08:00', '18:00'), {
    extra125: 2,
    extra150: 0,
    deficit: 0,
    base: 8,
  });

  assert.deepEqual(totalsForDay(MONDAY, '08:00', '19:00'), {
    extra125: 2,
    extra150: 1,
    deficit: 0,
    base: 8,
  });
});

test('there is no unpaid band above min_hours any more', () => {
  // Used to fall in the 8-9h gap and count as nothing; now it is half an hour of overtime.
  assert.deepEqual(totalsForDay(MONDAY, '08:00', '16:30'), {
    extra125: 0.5,
    extra150: 0,
    deficit: 0,
    base: 8,
  });
});

test('short days still count as missing hours against the eight owed', () => {
  assert.deepEqual(totalsForDay(MONDAY, '08:00', '15:00'), {
    extra125: 0,
    extra150: 0,
    deficit: 1,
    base: 8,
  });
});

test('min_hours drives the overtime threshold as well as the month base', () => {
  // A fixed 10-hour day lands differently on each contract.
  const cases: Array<[number, number, number, number]> = [
    // minHours, extra125, extra150, deficit
    [6, 2, 2, 0],
    [8, 2, 0, 0],
    [8.5, 1.5, 0, 0],
    [12, 0, 0, 2],
  ];
  for (const [minHours, extra125, extra150, deficit] of cases) {
    const totals = totalsForDay(MONDAY, '08:00', '18:00', minHours);
    assert.equal(totals.extra125, extra125, `min_hours ${minHours} 125%`);
    assert.equal(totals.extra150, extra150, `min_hours ${minHours} 150%`);
    assert.equal(totals.deficit, deficit, `min_hours ${minHours} deficit`);
    assert.equal(totals.base, minHours, 'base hours should follow min_hours');
  }
});

test('a min_hours of 0 falls back to the default instead of making everything overtime', () => {
  assert.deepEqual(totalsForDay(MONDAY, '08:00', '16:00', 0), {
    extra125: 0,
    extra150: 0,
    deficit: 0,
    base: 0,
  });
});

test('weekend hours pay 150% from the first minute', () => {
  assert.deepEqual(totalsForDay(SATURDAY, '09:00', '12:00'), {
    extra125: 0,
    extra150: 3,
    deficit: 0,
    base: 0,
  });
});

function generalAbsence(date: string, startTime: string, endTime: string) {
  return {
    unavailability_type: 'general' as const,
    start_date: date,
    end_date: date,
    start_time: startTime,
    end_time: endTime,
  };
}

test('an absence outside the clocked window leaves worked hours untouched', () => {
  // Clocked out at 13:00, so the 13:00–16:00 absence overlaps nothing: 5 worked, 3 missing.
  const result = calculateEmployeeExtraHours(
    [shift(MONDAY, '08:00', '13:00')],
    8,
    NO_HOLIDAYS,
    MONDAY,
    MONDAY,
    [generalAbsence(MONDAY, '13:00', '16:00')],
    NOW,
  );

  assert.equal(result.deficitHoursMs / MS_PER_HOUR, 3);
  assert.equal(result.extraHours125Ms, 0);
});

test('only the part of an absence spent on the clock is deducted from worked hours', () => {
  // 09:55–18:45 is 8h50m on the clock; the 09:00–17:00 absence overlaps 7h05m of it, since the
  // employee only clocked in at 09:55. Deducting the declared 8h would leave 50m instead.
  const result = calculateEmployeeExtraHours(
    [shift(MONDAY, '09:55', '18:45')],
    8,
    NO_HOLIDAYS,
    MONDAY,
    MONDAY,
    [generalAbsence(MONDAY, '09:00', '17:00')],
    NOW,
  );

  // 8h50m − 7h05m = 1h45m worked, so the day is 6h15m short and pays no overtime.
  assert.equal(result.deficitHoursMs / MS_PER_HOUR, 6.25);
  assert.equal(result.extraHours125Ms, 0);
  assert.equal(result.extraHours150Ms, 0);
});

test('an absence inside a long day cannot be paid as overtime', () => {
  // On the clock 09:00–19:00 but away for 3 of those hours: 7h worked, not 10h.
  const result = calculateEmployeeExtraHours(
    [shift(MONDAY, '09:00', '19:00')],
    8,
    NO_HOLIDAYS,
    MONDAY,
    MONDAY,
    [generalAbsence(MONDAY, '09:00', '11:00'), generalAbsence(MONDAY, '14:00', '15:00')],
    NOW,
  );

  assert.equal(result.extraHours125Ms, 0);
  assert.equal(result.extraHours150Ms, 0);
  assert.equal(result.deficitHoursMs / MS_PER_HOUR, 1);
});

test('overlapping absence windows on one day are not deducted twice', () => {
  const result = calculateEmployeeExtraHours(
    [shift(MONDAY, '08:00', '18:00')],
    8,
    NO_HOLIDAYS,
    MONDAY,
    MONDAY,
    [generalAbsence(MONDAY, '10:00', '13:00'), generalAbsence(MONDAY, '11:00', '12:00')],
    NOW,
  );

  // 10h on the clock minus the merged 10:00–13:00 window is 7h worked, so 1h missing.
  assert.equal(result.deficitHoursMs / MS_PER_HOUR, 1);
  assert.equal(result.extraHours125Ms, 0);
});

test('a general absence without times leaves the full day owed', () => {
  const result = calculateEmployeeExtraHours(
    [shift(MONDAY, '08:00', '13:00')],
    8,
    NO_HOLIDAYS,
    MONDAY,
    MONDAY,
    [
      {
        unavailability_type: 'general',
        start_date: MONDAY,
        end_date: MONDAY,
        start_time: null,
        end_time: null,
      },
    ],
    NOW,
  );

  assert.equal(result.deficitHoursMs / MS_PER_HOUR, DEFAULT_DAILY_MIN_HOURS - 5);
});

test('missing hours are offset against overtime value, 150% first', () => {
  // Monday 7h (1h missing), Tuesday 12h on an 8h contract (2h at 125% + 2h at 150%).
  const result = calculateEmployeeExtraHours(
    [shift(MONDAY, '08:00', '15:00'), shift('2026-08-11', '08:00', '20:00')],
    8,
    NO_HOLIDAYS,
    MONDAY,
    '2026-08-11',
    [],
    NOW,
  );

  const hours = (ms: number) => Math.round((ms / MS_PER_HOUR) * 10_000) / 10_000;
  // 1 missing hour eats 1.0 of the 3.0 value in the 150% bucket, leaving 2.0 / 1.5.
  assert.equal(hours(result.extraHours150Ms), 1.3333);
  assert.equal(hours(result.extraHours125Ms), 2);
  assert.equal(hours(result.deficitHoursMs), 0);
});
