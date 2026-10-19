import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildMeetingConfirmation,
  decideMeetingCalendar,
  isExternalMeetingLocation,
  decideMeetingStage,
  findRoomConflict,
  formatMeetingDate,
  hasMeetingParticipants,
  meetingGuestAttendees,
  normalizeAttendanceProbability,
  normalizeComplexity,
  normalizeDurationMinutes,
  normalizeMeetingCalendarRequest,
  normalizeMeetingDateInput,
  normalizeMeetingTimeInput,
  pickMeetingLocation,
  shouldAskToRescheduleInstead,
} from './aiMeetingBooking';
import { clientCalendarEmailForType } from './graph';

/** A Thursday, so the weekday tests have something to count forward from. */
const TODAY = '2026-10-15';

function dateOf(result: ReturnType<typeof normalizeMeetingDateInput>): string {
  assert.ok('date' in result, `expected a date, got ${JSON.stringify(result)}`);
  return (result as { date: string }).date;
}

function timeOf(result: ReturnType<typeof normalizeMeetingTimeInput>): string {
  assert.ok('time' in result, `expected a time, got ${JSON.stringify(result)}`);
  return (result as { time: string }).time;
}

test('the day wordings people use resolve against today', () => {
  assert.equal(dateOf(normalizeMeetingDateInput('today', TODAY)), TODAY);
  assert.equal(dateOf(normalizeMeetingDateInput('tomorrow', TODAY)), '2026-10-16');
  assert.equal(dateOf(normalizeMeetingDateInput('Day after tomorrow', TODAY)), '2026-10-17');
});

test('written dates are read as day/month, and ISO passes through', () => {
  assert.equal(dateOf(normalizeMeetingDateInput('2026-11-03', TODAY)), '2026-11-03');
  assert.equal(dateOf(normalizeMeetingDateInput('2026-1-3', TODAY)), '2026-01-03');
  assert.equal(dateOf(normalizeMeetingDateInput('3.11.2026', TODAY)), '2026-11-03');
  assert.equal(dateOf(normalizeMeetingDateInput('3/11/26', TODAY)), '2026-11-03');
});

test('a date the model wrote out in words, or with the time stuck to it, still reads', () => {
  assert.equal(dateOf(normalizeMeetingDateInput('tomorrow at 19:00', TODAY)), '2026-10-16');
  assert.equal(dateOf(normalizeMeetingDateInput('Mon, 19 October', TODAY)), '2026-10-19');
  assert.equal(dateOf(normalizeMeetingDateInput('19 Oct 2026', TODAY)), '2026-10-19');
  assert.equal(dateOf(normalizeMeetingDateInput('October 19', TODAY)), '2026-10-19');
  assert.equal(dateOf(normalizeMeetingDateInput('in 3 days', TODAY)), '2026-10-18');
});

test('a day and month with no year mean the next time that date comes round', () => {
  assert.equal(dateOf(normalizeMeetingDateInput('19/10', TODAY)), '2026-10-19');
  // Already past this year, so it is next year.
  assert.equal(dateOf(normalizeMeetingDateInput('3 January', TODAY)), '2027-01-03');
  assert.equal(dateOf(normalizeMeetingDateInput('2.1', TODAY)), '2027-01-02');
});

test('a weekday means the next one, never today', () => {
  // 2026-10-15 is a Thursday.
  assert.equal(dateOf(normalizeMeetingDateInput('monday', TODAY)), '2026-10-19');
  assert.equal(dateOf(normalizeMeetingDateInput('next Monday', TODAY)), '2026-10-19');
  assert.equal(dateOf(normalizeMeetingDateInput('thursday', TODAY)), '2026-10-22');
});

test('a date that cannot be read is a question, not a guess', () => {
  assert.ok('error' in normalizeMeetingDateInput('', TODAY));
  assert.ok('error' in normalizeMeetingDateInput('sometime next week', TODAY));
  assert.ok('error' in normalizeMeetingDateInput('3.13.2026', TODAY));
});

test('a signed client met at a court, ministry, embassy or bank is an external meeting', () => {
  for (const location of [
    'Court',
    'Government',
    'Ministry of Interior',
    'Embassy',
    'Bank',
    'Jerusalem Courthouse',
  ]) {
    const decision = decideMeetingCalendar({ stage: 60, locationName: location });
    assert.equal(decision.calendar, 'staff', location);
    assert.equal(decision.internalTypeCode, 'extern', location);
    assert.match(decision.label, /external meeting/);
    assert.ok(decision.note, `${location} should explain itself`);
  }
  // The stage is what makes it external — an unsigned lead keeps its client calendar.
  const unsigned = decideMeetingCalendar({ stage: 20, locationName: 'Court' });
  assert.equal(unsigned.calendar, 'potential_client');
  assert.equal(unsigned.note, null);
});

test('an external meeting leaves the lead stage alone', () => {
  const decision = decideMeetingCalendar({ stage: 70, locationName: 'Embassy' });
  assert.equal(decideMeetingStage({ stage: 70, calendar: decision.calendar, mode: 'schedule' }).stage, null);
});

test('ordinary locations are not external meetings', () => {
  for (const location of ['Teams', 'TLV Office', 'Jrslm Office', 'Phone', 'Zoom Room 3']) {
    assert.equal(isExternalMeetingLocation(location), false, location);
    assert.equal(decideMeetingCalendar({ stage: 60, locationName: location }).calendar, 'active_client');
  }
});

test('times are read from every spelling that means one clock time', () => {
  assert.equal(timeOf(normalizeMeetingTimeInput('19:00')), '19:00');
  assert.equal(timeOf(normalizeMeetingTimeInput('9:05')), '09:05');
  assert.equal(timeOf(normalizeMeetingTimeInput('7pm')), '19:00');
  assert.equal(timeOf(normalizeMeetingTimeInput('7:30 PM')), '19:30');
  assert.equal(timeOf(normalizeMeetingTimeInput('12am')), '00:00');
  assert.equal(timeOf(normalizeMeetingTimeInput('12pm')), '12:00');
  assert.equal(timeOf(normalizeMeetingTimeInput('1900')), '19:00');
  assert.equal(timeOf(normalizeMeetingTimeInput('9')), '09:00');
});

test('an impossible time is rejected', () => {
  assert.ok('error' in normalizeMeetingTimeInput('25:00'));
  assert.ok('error' in normalizeMeetingTimeInput('19:75'));
  assert.ok('error' in normalizeMeetingTimeInput('after lunch'));
  assert.ok('error' in normalizeMeetingTimeInput(''));
});

test('the Outlook calendar follows the stage, not the request', () => {
  const beforeSigning = decideMeetingCalendar({ stage: 20 });
  assert.equal(beforeSigning.calendar, 'potential_client');
  assert.equal(beforeSigning.note, null);

  const signed = decideMeetingCalendar({ stage: 60 });
  assert.equal(signed.calendar, 'active_client');
  assert.equal(signed.note, null);

  const askedActiveTooEarly = decideMeetingCalendar({ stage: 20, requested: 'active_client' });
  assert.equal(askedActiveTooEarly.calendar, 'potential_client');
  assert.match(String(askedActiveTooEarly.note), /not signed/i);

  const askedPotentialTooLate = decideMeetingCalendar({ stage: 70, requested: 'potential_client' });
  assert.equal(askedPotentialTooLate.calendar, 'active_client');
  assert.match(String(askedPotentialTooLate.note), /already signed/i);
});

test('each client calendar maps to its own shared Outlook mailbox', () => {
  assert.equal(clientCalendarEmailForType('potential_client'), 'shared-potentialclients@lawoffice.org.il');
  assert.equal(clientCalendarEmailForType('active_client'), 'shared-newclients@lawoffice.org.il');
  // Anything unexpected falls back to the sales calendar rather than the signed-client one.
  assert.equal(clientCalendarEmailForType(null), 'shared-potentialclients@lawoffice.org.il');
});

test('internal meetings go to the staff calendar whatever the stage says', () => {
  for (const stage of [10, 55, 60, 100]) {
    assert.equal(decideMeetingCalendar({ stage, requested: 'internal' }).calendar, 'staff');
  }
});

test('calendar requests are read loosely', () => {
  assert.equal(normalizeMeetingCalendarRequest('Potential'), 'potential_client');
  assert.equal(normalizeMeetingCalendarRequest('active client'), 'active_client');
  assert.equal(normalizeMeetingCalendarRequest('external'), 'internal');
  assert.equal(normalizeMeetingCalendarRequest('staff'), 'internal');
  assert.equal(normalizeMeetingCalendarRequest(undefined), 'auto');
  assert.equal(normalizeMeetingCalendarRequest('whatever'), 'auto');
});

test('a first booking moves the lead to Meeting scheduled', () => {
  const decision = decideMeetingStage({ stage: 10, calendar: 'potential_client', mode: 'schedule' });
  assert.equal(decision.stage, 20);
});

test('a lead past the first meeting round moves to Another meeting', () => {
  assert.equal(decideMeetingStage({ stage: 40, calendar: 'potential_client', mode: 'schedule' }).stage, 55);
  assert.equal(decideMeetingStage({ stage: 55, calendar: 'potential_client', mode: 'schedule' }).stage, 55);
});

test('a signed client never has their stage moved by a meeting', () => {
  for (const stage of [60, 65, 100]) {
    assert.equal(decideMeetingStage({ stage, calendar: 'active_client', mode: 'schedule' }).stage, null);
    assert.equal(decideMeetingStage({ stage, calendar: 'active_client', mode: 'reschedule' }).stage, null);
  }
});

test('internal meetings leave the stage alone', () => {
  assert.equal(decideMeetingStage({ stage: 10, calendar: 'staff', mode: 'schedule' }).stage, null);
});

test('rescheduling puts the lead back on Meeting scheduled, unless it is on Another meeting', () => {
  assert.equal(decideMeetingStage({ stage: 21, calendar: 'potential_client', mode: 'reschedule' }).stage, 20);
  assert.equal(decideMeetingStage({ stage: 40, calendar: 'potential_client', mode: 'reschedule' }).stage, 20);
  assert.equal(decideMeetingStage({ stage: 55, calendar: 'potential_client', mode: 'reschedule' }).stage, null);
});

test('a room is taken for the whole hour, not just the exact minute', () => {
  const booked = [{ id: 7, meeting_time: '14:30' }];
  assert.equal(findRoomConflict(booked, '14:00')?.id, 7);
  assert.equal(findRoomConflict(booked, '14:45')?.id, 7);
  assert.equal(findRoomConflict(booked, '15:00'), null);
  assert.equal(findRoomConflict([], '14:00'), null);
});

test('location names are matched loosely and default to Teams', () => {
  const locations = [
    { id: 1, name: 'Teams', is_active: true },
    { id: 2, name: 'Jerusalem Office', is_active: true },
    { id: 3, name: 'Zoom room 3', is_active: false },
  ];
  assert.equal(pickMeetingLocation(locations, undefined)?.name, 'Teams');
  assert.equal(pickMeetingLocation(locations, 'teams')?.name, 'Teams');
  assert.equal(pickMeetingLocation(locations, 'jerusalem')?.name, 'Jerusalem Office');
  assert.equal(pickMeetingLocation(locations, 'office')?.name, 'Jerusalem Office');
  // Retired locations are not offered, and an unknown name is reported rather than swapped.
  assert.equal(pickMeetingLocation(locations, 'zoom room 3'), null);
  assert.equal(pickMeetingLocation(locations, 'Mars'), null);
});

test('an unsigned lead with a meeting already booked should be rescheduled instead', () => {
  const activeMeetings = [{ meeting_date: '2026-10-20' }];
  assert.equal(shouldAskToRescheduleInstead({ stage: 20, activeMeetings, todayIso: TODAY }).ask, true);
  // A signed client can hold any number of meetings, so a second booking is fine.
  assert.equal(shouldAskToRescheduleInstead({ stage: 60, activeMeetings, todayIso: TODAY }).ask, false);
  // Only an upcoming meeting counts; a past one is not in the way.
  assert.equal(
    shouldAskToRescheduleInstead({ stage: 20, activeMeetings: [{ meeting_date: '2026-09-01' }], todayIso: TODAY }).ask,
    false,
  );
  assert.equal(shouldAskToRescheduleInstead({ stage: 20, activeMeetings: [], todayIso: TODAY }).ask, false);
});

test('defaults fill in the fields the meeting row needs', () => {
  assert.equal(normalizeDurationMinutes(undefined), 30);
  assert.equal(normalizeDurationMinutes('45'), 45);
  assert.equal(normalizeDurationMinutes(-5), 30);
  assert.equal(normalizeAttendanceProbability('very high'), 'Very High');
  assert.equal(normalizeAttendanceProbability('nonsense'), 'Medium');
  assert.equal(normalizeComplexity('COMPLEX'), 'Complex');
  assert.equal(normalizeComplexity(undefined), 'Simple');
});

test('dates are confirmed in a form a person can check', () => {
  assert.equal(formatMeetingDate('2026-10-19'), 'Mon 19 Oct 2026');
  assert.equal(formatMeetingDate('nonsense'), 'nonsense');
});

test('the confirmation leads with one sentence that stands on its own', () => {
  const message = buildMeetingConfirmation({
    leadNumber: 'L228842',
    leadName: 'Daniel Dirnfeld',
    isLegacy: false,
    date: '2026-10-20',
    time: '19:00',
    durationMinutes: 30,
    location: 'Teams',
    calendarLabel: 'Potential Clients Outlook calendar',
    manager: 'Anna Zh',
    helper: '',
    mode: 'schedule',
    stageNote: 'Lead stage moved to Meeting scheduled.',
    outlookCalendarEmail: 'shared-potentialclients@lawoffice.org.il',
    replaced: null,
    notes: [],
  });
  const lines = message.split('\n');
  assert.equal(lines[0], 'Scheduled the meeting for L228842 Daniel Dirnfeld to Tue 20 Oct 2026 at 19:00.');
  assert.match(message, /Manager: Anna Zh · Helper: —/);
  assert.match(message, /Lead stage moved to Meeting scheduled\./);
  assert.match(message, /Added to the shared-potentialclients@lawoffice\.org\.il Outlook calendar\./);
});

test('a reschedule confirmation names the meeting it replaced', () => {
  const message = buildMeetingConfirmation({
    leadNumber: '209994/9',
    leadName: 'Legacy Client',
    isLegacy: true,
    date: '2026-10-20',
    time: '09:00',
    durationMinutes: 60,
    location: 'Jerusalem Office',
    calendarLabel: 'Active Clients Outlook calendar',
    manager: '',
    helper: '',
    mode: 'reschedule',
    stageNote: 'Lead stage unchanged (Client signed agreement) — meetings never move a signed client.',
    replaced: { date: '2026-10-16', time: '14:00' },
    notes: [],
  });
  assert.match(message, /^Moved the meeting for 209994\/9 Legacy Client to Tue 20 Oct 2026 at 09:00\./);
  assert.match(message, /Previous meeting on Fri 16 Oct 2026 at 14:00 is now cancelled\./);
  assert.match(message, /\(legacy lead\)/);
});

test('a participant list counts only colleagues and people who were actually named', () => {
  assert.equal(hasMeetingParticipants(undefined), false);
  assert.equal(hasMeetingParticipants({ staffEmployeeIds: [], guests: [] }), false);
  assert.equal(hasMeetingParticipants({ guests: [{ name: '  ' }] }), false);
  assert.equal(hasMeetingParticipants({ staffEmployeeIds: [12] }), true);
  assert.equal(hasMeetingParticipants({ guests: [{ name: 'Court clerk' }] }), true);
});

test('only guests with an email address are invited to the calendar event', () => {
  const invited = meetingGuestAttendees({
    guests: [
      { name: 'Court clerk' },
      { name: 'Dana Levi', email: ' dana@example.com ' },
      { name: '', email: 'nobody@example.com' },
    ],
  });
  assert.deepEqual(invited, [{ email: 'dana@example.com', name: 'Dana Levi' }]);
});
