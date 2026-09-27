import assert from 'node:assert/strict';
import test from 'node:test';

import {
  OVERTIME_BASE_DAILY_HOURS,
  REQUIRED_DAILY_HOURS,
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

test('overtime starts after nine hours, not after eight', () => {
  assert.equal(OVERTIME_BASE_DAILY_HOURS, 9);

  assert.deepEqual(totalsForDay(MONDAY, '08:00', '17:00'), {
    extra125: 0,
    extra150: 0,
    deficit: 0,
    base: 8,
  });

  assert.deepEqual(totalsForDay(MONDAY, '08:00', '18:00'), {
    extra125: 1,
    extra150: 0,
    deficit: 0,
    base: 8,
  });
});

test('the first two overtime hours pay 125%, the rest 150%', () => {
  assert.deepEqual(totalsForDay(MONDAY, '08:00', '19:00'), {
    extra125: 2,
    extra150: 0,
    deficit: 0,
    base: 8,
  });

  assert.deepEqual(totalsForDay(MONDAY, '08:00', '20:00'), {
    extra125: 2,
    extra150: 1,
    deficit: 0,
    base: 8,
  });
});

test('hours between the eight owed and the nine-hour base are neither missing nor overtime', () => {
  assert.equal(REQUIRED_DAILY_HOURS, 8);

  assert.deepEqual(totalsForDay(MONDAY, '08:00', '16:30'), {
    extra125: 0,
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

test('min_hours drives the month base but never the overtime threshold', () => {
  for (const minHours of [6, 8, 8.5, 12]) {
    const totals = totalsForDay(MONDAY, '08:00', '18:00', minHours);
    assert.equal(totals.extra125, 1, `min_hours ${minHours} must not move the 125% threshold`);
    assert.equal(totals.extra150, 0, `min_hours ${minHours} must not move the 150% threshold`);
    assert.equal(totals.base, minHours, 'base hours should follow min_hours');
  }
});

test('weekend hours pay 150% from the first minute', () => {
  assert.deepEqual(totalsForDay(SATURDAY, '09:00', '12:00'), {
    extra125: 0,
    extra150: 3,
    deficit: 0,
    base: 0,
  });
});

test('a timed general absence reduces what the day owes', () => {
  // Out from 13:00 to 16:00, so the day owes 5 hours and 5 hours were worked.
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
        start_time: '13:00',
        end_time: '16:00',
      },
    ],
    NOW,
  );

  assert.equal(result.deficitHoursMs, 0);
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

  assert.equal(result.deficitHoursMs / MS_PER_HOUR, REQUIRED_DAILY_HOURS - 5);
});

test('missing hours are offset against overtime value, 150% first', () => {
  // Monday 7h (1h missing), Tuesday 12h (2h at 125% + 1h at 150%).
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
  // 1 missing hour eats 1.0 of the 1.5 value in the 150% bucket, leaving 0.5 / 1.5.
  assert.equal(hours(result.extraHours150Ms), 0.3333);
  assert.equal(hours(result.extraHours125Ms), 2);
  assert.equal(hours(result.deficitHoursMs), 0);
});
