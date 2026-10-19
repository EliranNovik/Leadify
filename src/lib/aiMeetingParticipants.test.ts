import test from 'node:test';
import assert from 'node:assert/strict';

import {
  describeMeetingForPick,
  matchAttendeesByName,
  nameMeansSignedInUser,
  pickMeetingForParticipantEdit,
  type EditableMeeting,
  type MeetingAttendee,
} from './aiMeetingParticipants';

const meeting = (
  id: number,
  date: string,
  time: string,
  location: string,
  calendarType = 'potential_client',
): EditableMeeting => ({ id, date, time, location, calendarType });

const meetings: EditableMeeting[] = [
  meeting(1, '2026-10-20', '14:00', 'Teams'),
  meeting(2, '2026-10-20', '18:00', 'Teams'),
  meeting(3, '2026-10-20', '20:00', 'Ministry of Interior', 'staff'),
  meeting(4, '2026-10-22', '09:00', 'Court', 'staff'),
];

test('the place someone names is enough to pick the meeting', () => {
  const byPlace = pickMeetingForParticipantEdit(meetings, { location: 'court' });
  assert.equal(byPlace.status, 'picked');
  assert.equal(byPlace.status === 'picked' ? byPlace.meeting.id : null, 4);

  const ministry = pickMeetingForParticipantEdit(meetings, { location: 'ministry of interior' });
  assert.equal(ministry.status === 'picked' ? ministry.meeting.id : null, 3);
});

test('a court meeting at a time there is no court meeting is asked about, not guessed', () => {
  const pick = pickMeetingForParticipantEdit(meetings, {
    location: 'court',
    date: '2026-10-20',
    time: '17:00',
  });
  assert.equal(pick.status, 'none');
  assert.equal(pick.status === 'none' ? pick.meetings.length : 0, 4);
});

test('a date with two meetings on it is ambiguous rather than a guess', () => {
  const pick = pickMeetingForParticipantEdit(meetings, { date: '2026-10-20', location: 'Teams' });
  assert.equal(pick.status, 'ambiguous');
  assert.deepEqual(
    pick.status === 'ambiguous' ? pick.meetings.map((row) => row.id) : [],
    [1, 2],
  );
});

test('a date and time together pin one meeting down', () => {
  const pick = pickMeetingForParticipantEdit(meetings, { date: '2026-10-20', time: '18:00:00' });
  assert.equal(pick.status === 'picked' ? pick.meeting.id : null, 2);
});

test('a meeting id wins, and an unknown one matches nothing', () => {
  const byId = pickMeetingForParticipantEdit(meetings, { meetingId: 3, location: 'Teams' });
  assert.equal(byId.status === 'picked' ? byId.meeting.id : null, 3);
  assert.equal(pickMeetingForParticipantEdit(meetings, { meetingId: 99 }).status, 'none');
});

test('a day with no meeting comes back with the meetings there are', () => {
  const pick = pickMeetingForParticipantEdit(meetings, { date: '2026-10-21' });
  assert.equal(pick.status, 'none');
  assert.equal(pick.status === 'none' ? pick.meetings.length : 0, 4);
  assert.equal(pickMeetingForParticipantEdit([], { date: '2026-10-21' }).status, 'none');
});

test('a single meeting needs no description at all', () => {
  const pick = pickMeetingForParticipantEdit([meetings[0]], {});
  assert.equal(pick.status === 'picked' ? pick.meeting.id : null, 1);
});

test('meetings are described the way they would be read out', () => {
  assert.equal(describeMeetingForPick(meetings[3]), 'Thu 22 Oct 2026 at 09:00 · Court');
});

const attendees: MeetingAttendee[] = [
  { rowId: 'a', kind: 'staff', name: 'Anna Zh', employeeId: 12, email: null },
  { rowId: 'b', kind: 'guest', name: 'Irina Levi', employeeId: null, email: 'irina@example.com' },
  { rowId: 'c', kind: 'guest', name: 'Court clerk', employeeId: null, email: null },
];

test('someone can be taken off the meeting by first name', () => {
  assert.deepEqual(
    matchAttendeesByName(attendees, 'irina').map((row) => row.rowId),
    ['b'],
  );
  assert.deepEqual(matchAttendeesByName(attendees, 'Anna Zh').map((row) => row.rowId), ['a']);
  assert.deepEqual(matchAttendeesByName(attendees, 'nobody'), []);
  assert.deepEqual(matchAttendeesByName(attendees, '  '), []);
});

test('the person typing can put themselves on the meeting by saying me', () => {
  assert.equal(nameMeansSignedInUser('me'), true);
  assert.equal(nameMeansSignedInUser(' Myself '), true);
  assert.equal(nameMeansSignedInUser('I'), true);
  assert.equal(nameMeansSignedInUser('Irina'), false);
  assert.equal(nameMeansSignedInUser(''), false);
});
