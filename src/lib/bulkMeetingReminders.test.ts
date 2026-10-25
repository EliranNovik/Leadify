import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildBulkReminderTarget,
  buildBulkReminderTargets,
  isBulkReminderEligibleMeeting,
  resolveReminderLanguageForLead,
  summarizeBulkReminderResults,
  type BulkReminderChannelResult,
  type BulkReminderTargetResult,
} from './bulkMeetingReminders';

const NEW_LEAD = {
  id: '073e5418-5728-42aa-9596-367e2c9cf172',
  name: 'Dana Cohen',
  lead_number: 'L229882',
  lead_type: 'new',
  phone: '+972500000000',
  email: 'dana@example.com',
};

const clientMeeting = (overrides: Record<string, unknown> = {}) => ({
  id: 4821,
  calendar_type: 'potential_client',
  meeting_date: '2026-11-03',
  meeting_time: '14:30:00',
  meeting_location: 'Teams',
  lead: NEW_LEAD,
  ...overrides,
});

// ---------------------------------------------------------------- language

test('a lead with the Hebrew language id is reminded in Hebrew', () => {
  assert.equal(resolveReminderLanguageForLead({ id: 1, language_id: 2 }), 'he');
});

test('the joined language name is used when no language id is set', () => {
  assert.equal(resolveReminderLanguageForLead({ id: 1, language: 'Hebrew' }), 'he');
  assert.equal(resolveReminderLanguageForLead({ id: 1, language: 'עברית' }), 'he');
});

test('the language id wins over a stale language name', () => {
  assert.equal(resolveReminderLanguageForLead({ id: 1, language_id: 2, language: 'English' }), 'he');
});

test('every other language falls back to English, since reminders exist only in he and en', () => {
  assert.equal(resolveReminderLanguageForLead({ id: 1, language: 'Russian', language_id: 4 }), 'en');
  assert.equal(resolveReminderLanguageForLead({ id: 1, language: 'English' }), 'en');
  assert.equal(resolveReminderLanguageForLead({ id: 1 }), 'en');
});

// ---------------------------------------------------------------- eligibility

test('a client meeting with a lead can be reminded', () => {
  assert.equal(isBulkReminderEligibleMeeting(clientMeeting()), true);
  assert.equal(isBulkReminderEligibleMeeting(clientMeeting({ calendar_type: 'active_client' })), true);
});

test('internal and recruitment meetings are not selectable — they have no lead', () => {
  assert.equal(isBulkReminderEligibleMeeting(clientMeeting({ calendar_type: 'staff' })), false);
  assert.equal(isBulkReminderEligibleMeeting(clientMeeting({ calendar_type: 'recruitment' })), false);
});

test('a row without a lead, or with a staff placeholder lead, is not selectable', () => {
  assert.equal(isBulkReminderEligibleMeeting(clientMeeting({ lead: null })), false);
  assert.equal(isBulkReminderEligibleMeeting(clientMeeting({ lead: {} })), false);
  assert.equal(
    isBulkReminderEligibleMeeting(clientMeeting({ lead: { id: 'staff-meeting', isStaffMeeting: true } })),
    false,
  );
});

test('a row with no date is not selectable', () => {
  assert.equal(isBulkReminderEligibleMeeting(clientMeeting({ meeting_date: null })), false);
});

test('a legacy row with no calendar_type is still selectable', () => {
  const legacyRow = clientMeeting({
    id: 'legacy_210456',
    calendar_type: undefined,
    lead: { id: 'legacy_210456', name: 'Old Lead', lead_type: 'legacy' },
  });
  assert.equal(isBulkReminderEligibleMeeting(legacyRow), true);
});

// ---------------------------------------------------------------- target mapping

test('a calendar row is flattened into a target, trimming the seconds off the time', () => {
  const target = buildBulkReminderTarget(clientMeeting());
  assert.ok(target);
  assert.equal(target.rowId, '4821');
  assert.equal(target.dbMeetingId, 4821);
  assert.equal(target.date, '2026-11-03');
  assert.equal(target.time, '14:30');
  assert.equal(target.location, 'Teams');
  assert.equal(target.language, 'en');
  assert.equal(target.lead.lead_number, 'L229882');
});

test('a legacy row keeps its prefixed id and gets no numeric meeting id', () => {
  const target = buildBulkReminderTarget(
    clientMeeting({
      id: 'legacy_210456',
      lead: { id: 'legacy_210456', name: 'Old Lead', lead_type: 'legacy', language_id: 2 },
    }),
  );
  assert.ok(target);
  assert.equal(target.rowId, 'legacy_210456');
  assert.equal(target.dbMeetingId, null);
  assert.equal(target.language, 'he');
});

test('ineligible rows are dropped rather than returned as empty targets', () => {
  assert.equal(buildBulkReminderTarget(clientMeeting({ calendar_type: 'staff' })), null);

  const targets = buildBulkReminderTargets([
    clientMeeting(),
    clientMeeting({ id: 4822, calendar_type: 'staff' }),
    clientMeeting({ id: 4823, lead: null }),
  ]);
  assert.deepEqual(
    targets.map((t) => t.rowId),
    ['4821'],
  );
});

// ---------------------------------------------------------------- summary

const sent = (recipients: string[]): BulkReminderChannelResult => ({ status: 'sent', recipients });
const nothing = (status: 'failed' | 'skipped'): BulkReminderChannelResult => ({ status, recipients: [] });

const resultRow = (
  rowId: string,
  whatsapp: BulkReminderChannelResult,
  email: BulkReminderChannelResult,
): BulkReminderTargetResult => ({
  rowId,
  leadName: 'Lead',
  leadNumber: null,
  language: 'en',
  whatsapp,
  email,
});

test('the summary counts leads per channel and recipients within them', () => {
  const summary = summarizeBulkReminderResults([
    resultRow('1', sent(['+972500000001', '+972500000002']), sent(['a@example.com'])),
    resultRow('2', sent(['+972500000003']), nothing('failed')),
  ]);

  assert.equal(summary.total, 2);
  assert.equal(summary.whatsappSent, 2);
  assert.equal(summary.whatsappRecipients, 3);
  assert.equal(summary.emailSent, 1);
  assert.equal(summary.emailRecipients, 1);
  assert.equal(summary.emailFailed, 1);
  assert.equal(summary.fullyFailed, 0);
});

test('a partial WhatsApp send still counts as reached', () => {
  const summary = summarizeBulkReminderResults([
    resultRow('1', { status: 'partial', recipients: ['+972500000001'], reason: 'one number failed' }, nothing('skipped')),
  ]);
  assert.equal(summary.whatsappSent, 1);
  assert.equal(summary.whatsappRecipients, 1);
  assert.equal(summary.fullyFailed, 0);
});

test('a lead reached on neither channel is reported as fully failed', () => {
  const summary = summarizeBulkReminderResults([
    resultRow('1', nothing('failed'), nothing('skipped')),
    resultRow('2', nothing('skipped'), nothing('failed')),
  ]);
  assert.equal(summary.fullyFailed, 2);
  assert.equal(summary.whatsappSent, 0);
  assert.equal(summary.emailSent, 0);
});
