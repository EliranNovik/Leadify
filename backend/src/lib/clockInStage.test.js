/**
 * The clock-in policy's two thresholds, pinned.
 *
 * These decide who gets a reminder and who gets force-clocked-out, so the boundaries matter: an
 * off-by-one here either cuts people off an hour early or never cuts them off at all.
 */
const assert = require('node:assert/strict');
const test = require('node:test');

const {
  _internal: {
    resolveClockInStage,
    resolveClockInAllowanceMs,
    computeAllowanceClockOutIso,
    summarizeTodayHours,
    isPreAddedSession,
    describeAllowance,
    normalizeMinHours,
  },
  DEFAULT_MIN_HOURS,
} = require('../services/nineHourAutoClockOutService');

const HOUR = 60 * 60 * 1000;

/** The run's own composition: build the allowance from the contract, then read the stage off it. */
const stageFor = (elapsedMs, minHours, preAddedMs = 0) =>
  resolveClockInStage(elapsedMs, resolveClockInAllowanceMs(minHours, preAddedMs));

test('nothing happens before an hour short of base hours', () => {
  assert.equal(stageFor(0, 8), null);
  assert.equal(stageFor(6 * HOUR, 8), null);
  assert.equal(stageFor(7 * HOUR - 1, 8), null);
});

test('the reminder starts exactly an hour before base hours', () => {
  assert.equal(stageFor(7 * HOUR, 8), 'reminder');
  assert.equal(stageFor(7.5 * HOUR, 8), 'reminder');
  assert.equal(stageFor(8 * HOUR - 1, 8), 'reminder');
});

test('the clock-out starts exactly at base hours', () => {
  assert.equal(stageFor(8 * HOUR, 8), 'clock_out');
  assert.equal(stageFor(12 * HOUR, 8), 'clock_out');
});

test('the thresholds follow each contract, not a fixed nine hours', () => {
  // The seven employees on a nine-hour contract get an extra hour before either stage.
  assert.equal(stageFor(7 * HOUR, 9), null);
  assert.equal(stageFor(8 * HOUR, 9), 'reminder');
  assert.equal(stageFor(9 * HOUR, 9), 'clock_out');

  assert.equal(stageFor(3 * HOUR, 4), 'reminder');
  assert.equal(stageFor(4 * HOUR, 4), 'clock_out');
});

test('a missing or nonsense min_hours falls back to the company default', () => {
  assert.equal(normalizeMinHours(null), DEFAULT_MIN_HOURS);
  assert.equal(normalizeMinHours(0), DEFAULT_MIN_HOURS);
  assert.equal(normalizeMinHours(-3), DEFAULT_MIN_HOURS);
  assert.equal(normalizeMinHours('not a number'), DEFAULT_MIN_HOURS);
  assert.equal(stageFor(DEFAULT_MIN_HOURS * HOUR, null), 'clock_out');
});

test('an allowance of an hour or less goes straight to the clock-out with no reminder', () => {
  // Reminding an hour early would mean reminding them before they clocked in, so the stage is skipped
  // rather than fired at zero elapsed. No real contract is this short; min_hours bottoms out at 4.
  assert.equal(stageFor(0, 1), null);
  assert.equal(stageFor(59 * 60 * 1000, 1), null);
  assert.equal(stageFor(1 * HOUR, 1), 'clock_out');

  assert.equal(stageFor(0, 0.5), null);
  assert.equal(stageFor(0.5 * HOUR, 0.5), 'clock_out');
});

test('pre-added hours push both thresholds out by their own length', () => {
  // Two approved hours pre-added, so the day runs to ten and the reminder lands at nine.
  assert.equal(stageFor(8 * HOUR, 8, 2 * HOUR), null);
  assert.equal(stageFor(9 * HOUR - 1, 8, 2 * HOUR), null);
  assert.equal(stageFor(9 * HOUR, 8, 2 * HOUR), 'reminder');
  assert.equal(stageFor(10 * HOUR - 1, 8, 2 * HOUR), 'reminder');
  assert.equal(stageFor(10 * HOUR, 8, 2 * HOUR), 'clock_out');
});

test('pre-added hours leave the live session its full base hours', () => {
  /*
   * The regression this policy exists for. Pre-added hours sit in the elapsed total from the moment
   * the employee arrives, so measuring that total against bare base hours clocked them straight back
   * out. Counting the same hours into the allowance cancels them, whatever their length.
   */
  for (const preAdded of [0, 2 * HOUR, 6 * HOUR, 11 * HOUR]) {
    assert.equal(stageFor(preAdded, 8, preAdded), null, `${preAdded}ms pre-added, nothing worked yet`);
    assert.equal(stageFor(preAdded + 7 * HOUR, 8, preAdded), 'reminder');
    assert.equal(stageFor(preAdded + 8 * HOUR, 8, preAdded), 'clock_out');
  }
});

test('a second live session still counts toward the same day', () => {
  // Only hours entered by hand raise the allowance. Clocking out and back in does not reset the day.
  assert.equal(stageFor(7 * HOUR, 8, 0), 'reminder');
  assert.equal(stageFor(8 * HOUR, 8, 0), 'clock_out');
});

test('a session is stamped at the moment the allowance ran out, not when the run noticed', () => {
  const clockIn = '2026-10-11T06:00:00.000Z';
  // Scheduler ticks once a minute, so "now" can sit past the threshold.
  const noticedAt = new Date('2026-10-11T14:00:45.000Z').getTime();
  assert.equal(
    computeAllowanceClockOutIso(clockIn, 8 * HOUR, 0, noticedAt),
    '2026-10-11T14:00:00.000Z',
  );
});

test('earlier sessions the same day count toward the allowance', () => {
  const clockIn = '2026-10-11T10:00:00.000Z';
  const noticedAt = new Date('2026-10-11T18:00:00.000Z').getTime();
  // Three hours already banked, so this session closes after five more.
  assert.equal(
    computeAllowanceClockOutIso(clockIn, 8 * HOUR, 3 * HOUR, noticedAt),
    '2026-10-11T15:00:00.000Z',
  );
});

test('the clock-out stamp is never written into the future or before clock-in', () => {
  const clockIn = '2026-10-11T09:00:00.000Z';
  const noticedAt = new Date('2026-10-11T10:00:00.000Z').getTime();
  // Allowance not yet used up: clamped to now rather than stamped two hours ahead.
  assert.equal(
    computeAllowanceClockOutIso(clockIn, 3 * HOUR, 0, noticedAt),
    '2026-10-11T10:00:00.000Z',
  );
  // Allowance already exhausted by earlier sessions: clamped to clock-in, not before it.
  assert.equal(
    computeAllowanceClockOutIso(clockIn, 8 * HOUR, 20 * HOUR, noticedAt),
    '2026-10-11T09:00:00.000Z',
  );
});

test('a pre-added row is recognised however the entry screen flagged it', () => {
  // The manual screens clear `manually` when the session is short enough to auto-approve, so
  // `location_source` has to carry the distinction on its own.
  assert.equal(isPreAddedSession({ manually: true, location_source: 'gps' }), true);
  assert.equal(isPreAddedSession({ manually: false, location_source: 'manual' }), true);
  assert.equal(isPreAddedSession({ manually: false, location_source: 'Manual ' }), true);
  assert.equal(isPreAddedSession({ manually: false, location_source: 'gps' }), false);
  assert.equal(isPreAddedSession({}), false);
});

test("a day's rows split into elapsed, pre-added and already-closed hours", () => {
  /*
   * The agreed scenario: an eight-hour employee pre-adds an approved 19:00-21:00 block, then clocks
   * in live at 09:00. At 16:00 they are due the reminder and at 17:00 the clock-out, which is a full
   * eight hours of live work rather than the six the old arithmetic left them.
   */
  const rows = [
    {
      id: 1,
      clock_in_time: '2026-10-11T19:00:00.000Z',
      clock_out_time: '2026-10-11T21:00:00.000Z',
      manually: true,
      location_source: 'manual',
    },
    {
      id: 2,
      clock_in_time: '2026-10-11T09:00:00.000Z',
      clock_out_time: null,
      manually: false,
      location_source: 'gps',
    },
  ];

  const atReminder = summarizeTodayHours(rows, 2, new Date('2026-10-11T16:00:00.000Z').getTime());
  assert.deepEqual(atReminder, { elapsedMs: 9 * HOUR, preAddedMs: 2 * HOUR, closedMs: 2 * HOUR });
  assert.equal(stageFor(atReminder.elapsedMs, 8, atReminder.preAddedMs), 'reminder');

  const atClockOut = summarizeTodayHours(rows, 2, new Date('2026-10-11T17:00:00.000Z').getTime());
  assert.deepEqual(atClockOut, { elapsedMs: 10 * HOUR, preAddedMs: 2 * HOUR, closedMs: 2 * HOUR });
  assert.equal(stageFor(atClockOut.elapsedMs, 8, atClockOut.preAddedMs), 'clock_out');
  assert.equal(
    computeAllowanceClockOutIso(
      rows[1].clock_in_time,
      resolveClockInAllowanceMs(8, atClockOut.preAddedMs),
      atClockOut.closedMs,
      new Date('2026-10-11T17:00:00.000Z').getTime(),
    ),
    '2026-10-11T17:00:00.000Z',
  );
});

test('a declined entry is not worked time and does not extend the day', () => {
  const rows = [
    {
      id: 1,
      clock_in_time: '2026-10-11T05:00:00.000Z',
      clock_out_time: '2026-10-11T08:00:00.000Z',
      manually: true,
      declined: true,
      location_source: 'manual',
    },
    {
      id: 2,
      clock_in_time: '2026-10-11T09:00:00.000Z',
      clock_out_time: null,
      location_source: 'gps',
    },
  ];

  const summary = summarizeTodayHours(rows, 2, new Date('2026-10-11T16:00:00.000Z').getTime());
  assert.deepEqual(summary, { elapsedMs: 7 * HOUR, preAddedMs: 0, closedMs: 0 });
  // Seven live hours against a plain eight-hour allowance: the reminder, not the clock-out.
  assert.equal(stageFor(summary.elapsedMs, 8, summary.preAddedMs), 'reminder');
});

test('the open session itself never counts as pre-added or already closed', () => {
  const rows = [
    {
      id: 7,
      clock_in_time: '2026-10-11T09:00:00.000Z',
      clock_out_time: null,
      // An edited live session carries the manual marker, but it is still the session being measured.
      manually: true,
      location_source: 'manual',
    },
  ];

  assert.deepEqual(
    summarizeTodayHours(rows, 7, new Date('2026-10-11T14:00:00.000Z').getTime()),
    { elapsedMs: 5 * HOUR, preAddedMs: 0, closedMs: 0 },
  );
});

test('unreadable timestamps are skipped rather than counted as a whole day', () => {
  const rows = [
    { id: 1, clock_in_time: null, clock_out_time: '2026-10-11T12:00:00.000Z' },
    { id: 2, clock_in_time: 'not a date', clock_out_time: null },
    { id: 3, clock_in_time: '2026-10-11T09:00:00.000Z', clock_out_time: 'not a date' },
  ];

  // Row 3 keeps its start and falls back to `now` for the end, which is what an open session does.
  assert.deepEqual(
    summarizeTodayHours(rows, null, new Date('2026-10-11T11:00:00.000Z').getTime()),
    { elapsedMs: 2 * HOUR, preAddedMs: 0, closedMs: 0 },
  );
});

test('the note left on a clock-out spells out where the allowance came from', () => {
  assert.equal(describeAllowance(8, 0), 'base hours (8h)');
  assert.equal(describeAllowance(8, 2 * HOUR), '10h (base 8h + 2h pre-added)');
  assert.equal(describeAllowance(8, 1.5 * HOUR), '9.5h (base 8h + 1.5h pre-added)');
});
