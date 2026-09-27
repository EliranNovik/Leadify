import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildAutoFilledClockInRecords,
  isAutoFilledClockInRecord,
  withAutoFilledClockInRecords,
} from './autoFilledWorkingHours';
import type { UnavailabilityDayEffectInput } from './employeeUnavailabilities';
import type { ClockInExportRecord } from './workingHoursExport';

/**
 * These assertions compare wall-clock strings, so they assume the Jerusalem zone.
 * October 2026 has no statutory holiday on a working day, which keeps the fixtures
 * free of holiday noise; holiday skipping is covered with a synthetic map instead.
 */

const NO_HOLIDAYS = new Map<string, string[]>();

function fill(overrides: {
  dateFrom: string;
  dateTo: string;
  minHours?: number;
  existingRecords?: ClockInExportRecord[];
  unavailabilities?: UnavailabilityDayEffectInput[];
  holidayMap?: Map<string, string[]>;
  asOfDate?: string;
}) {
  return buildAutoFilledClockInRecords({
    employeeId: 7,
    minHours: overrides.minHours ?? 8,
    dateFrom: overrides.dateFrom,
    dateTo: overrides.dateTo,
    holidayMap: overrides.holidayMap ?? NO_HOLIDAYS,
    existingRecords: overrides.existingRecords ?? [],
    unavailabilities: overrides.unavailabilities,
    asOfDate: overrides.asOfDate ?? '2026-12-31',
  });
}

function dateKeys(records: ClockInExportRecord[]): string[] {
  return records.map((record) => record.clock_in_time.slice(0, 10));
}

function unavailability(
  type: string,
  startDate: string,
  endDate: string,
  startTime: string | null = null,
  endTime: string | null = null,
): UnavailabilityDayEffectInput {
  return {
    unavailability_type: type,
    start_date: startDate,
    end_date: endDate,
    start_time: startTime,
    end_time: endTime,
  };
}

test('fills min_hours from 09:00 on a regular workday', () => {
  const records = fill({ dateFrom: '2026-10-01', dateTo: '2026-10-01' });

  assert.equal(records.length, 1);
  assert.deepEqual(
    { in: records[0].clock_in_time, out: records[0].clock_out_time },
    { in: '2026-10-01T09:00:00+03:00', out: '2026-10-01T17:00:00+03:00' },
  );
  assert.equal(records[0].employee_id, 7);
  assert.ok(isAutoFilledClockInRecord(records[0]));
  // Auto-approved without anyone signing off, and carrying no note of its own.
  assert.equal(records[0].manually, false);
  assert.equal(records[0].approved, true);
  assert.equal(records[0].declined, false);
  assert.equal(records[0].notes, null);
});

test('a longer contract fills a longer day, still from 09:00', () => {
  const records = fill({ dateFrom: '2026-10-05', dateTo: '2026-10-05', minHours: 9.5 });

  assert.deepEqual(
    { in: records[0].clock_in_time, out: records[0].clock_out_time },
    { in: '2026-10-05T09:00:00+03:00', out: '2026-10-05T18:30:00+03:00' },
  );
});

test('nothing is filled before the start date', () => {
  assert.deepEqual(fill({ dateFrom: '2026-09-01', dateTo: '2026-09-24' }), []);
});

test('a range straddling the start date only fills from it onward', () => {
  const records = fill({ dateFrom: '2026-09-20', dateTo: '2026-10-01' });

  // The 27th is the start date and a Sunday; the 25th and 26th are the weekend before it.
  assert.deepEqual(dateKeys(records), [
    '2026-09-27',
    '2026-09-28',
    '2026-09-29',
    '2026-09-30',
    '2026-10-01',
  ]);
});

test('Friday and Saturday are left empty', () => {
  const records = fill({ dateFrom: '2026-10-22', dateTo: '2026-10-26' });

  // 23rd is a Friday and the 24th a Saturday.
  assert.deepEqual(dateKeys(records), ['2026-10-22', '2026-10-25', '2026-10-26']);
});

test('the 09:00 start follows the end of summer time', () => {
  const records = fill({ dateFrom: '2026-10-25', dateTo: '2026-10-25' });

  // Israel leaves IDT at 02:00 on the 25th, so this Sunday starts at 09:00 IST.
  assert.deepEqual(
    { in: records[0].clock_in_time, out: records[0].clock_out_time },
    { in: '2026-10-25T09:00:00+02:00', out: '2026-10-25T17:00:00+02:00' },
  );
});

test('statutory holidays and their eves are left empty', () => {
  const holidayMap = new Map<string, string[]>([['2026-10-06', ['Test Holiday']]]);
  const records = fill({ dateFrom: '2026-10-04', dateTo: '2026-10-07', holidayMap });

  // The 5th is the eve of the 6th.
  assert.deepEqual(dateKeys(records), ['2026-10-04', '2026-10-07']);
});

test('a day with a real clock-in is never filled', () => {
  const existingRecords: ClockInExportRecord[] = [
    {
      employee_id: 7,
      clock_in_time: '2026-10-05T11:30:00+03:00',
      clock_out_time: '2026-10-05T14:00:00+03:00',
      notes: null,
    },
  ];
  const records = fill({ dateFrom: '2026-10-05', dateTo: '2026-10-06', existingRecords });

  assert.deepEqual(dateKeys(records), ['2026-10-06']);
});

test('an unapproved clock-in still claims the day', () => {
  const existingRecords: ClockInExportRecord[] = [
    {
      employee_id: 7,
      clock_in_time: '2026-10-05T09:00:00+03:00',
      clock_out_time: '2026-10-05T17:00:00+03:00',
      notes: null,
      approved: false,
      declined: true,
    },
  ];

  assert.deepEqual(
    fill({ dateFrom: '2026-10-05', dateTo: '2026-10-05', existingRecords }),
    [],
  );
});

test('sick and vacation days are left empty', () => {
  const records = fill({
    dateFrom: '2026-10-05',
    dateTo: '2026-10-08',
    unavailabilities: [
      unavailability('sick_days', '2026-10-05', '2026-10-05'),
      unavailability('vacation', '2026-10-07', '2026-10-07'),
    ],
  });

  assert.deepEqual(dateKeys(records), ['2026-10-06', '2026-10-08']);
});

test('a timed general absence shortens the filled day', () => {
  const records = fill({
    dateFrom: '2026-10-05',
    dateTo: '2026-10-05',
    unavailabilities: [unavailability('general', '2026-10-05', '2026-10-05', '13:00', '16:00')],
  });

  assert.deepEqual(
    { in: records[0].clock_in_time, out: records[0].clock_out_time },
    { in: '2026-10-05T09:00:00+03:00', out: '2026-10-05T14:00:00+03:00' },
  );
});

test('a general absence without times leaves the day at full hours', () => {
  const records = fill({
    dateFrom: '2026-10-05',
    dateTo: '2026-10-05',
    unavailabilities: [unavailability('general', '2026-10-05', '2026-10-05')],
  });

  assert.equal(records[0].clock_out_time, '2026-10-05T17:00:00+03:00');
});

test('a general absence covering the whole day fills nothing', () => {
  const records = fill({
    dateFrom: '2026-10-05',
    dateTo: '2026-10-05',
    unavailabilities: [unavailability('general', '2026-10-05', '2026-10-05', '09:00', '17:00')],
  });

  assert.deepEqual(records, []);
});

test('days after today are left empty', () => {
  const records = fill({ dateFrom: '2026-10-05', dateTo: '2026-10-09', asOfDate: '2026-10-06' });

  assert.deepEqual(dateKeys(records), ['2026-10-05', '2026-10-06']);
});

test('real rows are kept alongside the filled ones', () => {
  const existingRecords: ClockInExportRecord[] = [
    {
      employee_id: 7,
      clock_in_time: '2026-10-05T08:00:00+03:00',
      clock_out_time: '2026-10-05T19:00:00+03:00',
      notes: null,
    },
  ];
  const merged = withAutoFilledClockInRecords({
    employeeId: 7,
    minHours: 8,
    dateFrom: '2026-10-05',
    dateTo: '2026-10-06',
    holidayMap: NO_HOLIDAYS,
    existingRecords,
    asOfDate: '2026-12-31',
  });

  assert.equal(merged.length, 2);
  assert.equal(merged[0].clock_in_time, '2026-10-05T08:00:00+03:00');
  assert.ok(isAutoFilledClockInRecord(merged[1]));
});
