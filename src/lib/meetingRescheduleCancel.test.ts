import test from 'node:test';
import assert from 'node:assert/strict';

import { defaultMeetingIdsToCancel, sortMeetingsForRescheduleCancel } from './meetingRescheduleCancel';

const TODAY = '2026-10-15';

const MEETINGS = [
  { id: 3, meeting_date: '2026-10-22', meeting_time: '09:00' },
  { id: 1, meeting_date: '2026-10-16', meeting_time: '14:00' },
  { id: 2, meeting_date: '2026-10-16', meeting_time: '09:00' },
  { id: 9, meeting_date: '2026-09-30', meeting_time: '10:00' },
];

test('upcoming meetings come first, earliest date and time leading', () => {
  const sorted = sortMeetingsForRescheduleCancel(MEETINGS, TODAY);
  assert.deepEqual(sorted.map((m) => m.id), [2, 1, 3, 9]);
});

test('by default every upcoming meeting is ticked for cancellation', () => {
  assert.deepEqual(defaultMeetingIdsToCancel(MEETINGS, TODAY), [3, 1, 2]);
});

test('with onlySoonest just the next meeting is ticked, so the others survive', () => {
  assert.deepEqual(defaultMeetingIdsToCancel(MEETINGS, TODAY, { onlySoonest: true }), [2]);
});

test('onlySoonest finds the next meeting whatever order it arrives in', () => {
  const shuffled = [MEETINGS[0], MEETINGS[1], MEETINGS[2]];
  assert.deepEqual(defaultMeetingIdsToCancel(shuffled, TODAY, { onlySoonest: true }), [2]);
});

test("today's meeting counts as upcoming", () => {
  const meetings = [{ id: 5, meeting_date: TODAY, meeting_time: '16:00' }];
  assert.deepEqual(defaultMeetingIdsToCancel(meetings, TODAY), [5]);
  assert.deepEqual(defaultMeetingIdsToCancel(meetings, TODAY, { onlySoonest: true }), [5]);
});

test('with nothing upcoming the first meeting in the list is used, in both modes', () => {
  const past = [
    { id: 7, meeting_date: '2026-10-01', meeting_time: '09:00' },
    { id: 8, meeting_date: '2026-09-01', meeting_time: '09:00' },
  ];
  assert.deepEqual(defaultMeetingIdsToCancel(past, TODAY), [7]);
  assert.deepEqual(defaultMeetingIdsToCancel(past, TODAY, { onlySoonest: true }), [7]);
});

test('an empty list ticks nothing', () => {
  assert.deepEqual(defaultMeetingIdsToCancel([], TODAY), []);
  assert.deepEqual(defaultMeetingIdsToCancel([], TODAY, { onlySoonest: true }), []);
});

test('rows without a usable id are dropped rather than ticked as NaN', () => {
  const meetings = [
    { id: null, meeting_date: '2026-10-16', meeting_time: '09:00' },
    { id: 4, meeting_date: '2026-10-17', meeting_time: '09:00' },
  ];
  assert.deepEqual(defaultMeetingIdsToCancel(meetings, TODAY), [4]);
});
