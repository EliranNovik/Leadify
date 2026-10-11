/**
 * When a manually entered session needs Michael's overtime approval.
 *
 * The threshold is the employee's own `min_hours`, which is also what `employeeExtraHours.ts` pays
 * overtime from. It was a flat nine hours, which let an eight-hour employee bank an hour of 125%
 * overtime with nobody signing off, so these pin the two rules together.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  clockSessionDurationMinutes,
  clockSessionExceedsOvertimeBase,
} from './employeeClockInOvertimeApproval';

test('a session up to base hours needs no approval', () => {
  assert.equal(clockSessionExceedsOvertimeBase('09:00', '17:00', 8), false);
  assert.equal(clockSessionExceedsOvertimeBase('09:00', '12:00', 8), false);
});

test('anything past base hours needs approval, not just a full extra hour', () => {
  assert.equal(clockSessionExceedsOvertimeBase('09:00', '17:01', 8), true);
  assert.equal(clockSessionExceedsOvertimeBase('09:00', '17:30', 8), true);
  assert.equal(clockSessionExceedsOvertimeBase('09:00', '18:00', 8), true);
});

test('the threshold follows the contract rather than a flat nine hours', () => {
  // The old rule let this through: 8h30m on an eight-hour contract.
  assert.equal(clockSessionExceedsOvertimeBase('09:00', '17:30', 8), true);
  // A nine-hour contract still gets its ninth hour without approval.
  assert.equal(clockSessionExceedsOvertimeBase('09:00', '18:00', 9), false);
  assert.equal(clockSessionExceedsOvertimeBase('09:00', '18:01', 9), true);
  // And the short contracts are held to their own day.
  assert.equal(clockSessionExceedsOvertimeBase('09:00', '13:00', 4), false);
  assert.equal(clockSessionExceedsOvertimeBase('09:00', '13:15', 4), true);
});

test('a missing or nonsense base falls back to the company default rather than blocking everything', () => {
  for (const base of [0, -2, Number.NaN]) {
    assert.equal(clockSessionExceedsOvertimeBase('09:00', '17:00', base), false);
    assert.equal(clockSessionExceedsOvertimeBase('09:00', '17:01', base), true);
  }
});

test('an unparseable or reversed session is not treated as overtime', () => {
  assert.equal(clockSessionDurationMinutes('', ''), 0);
  assert.equal(clockSessionExceedsOvertimeBase('', '', 8), false);
  assert.equal(clockSessionExceedsOvertimeBase('17:00', '09:00', 8), false);
});
