import test from 'node:test';
import assert from 'node:assert/strict';

import { describeMeetingReminderMark, resolveReminderRowIds } from './meetingReminderSends';

// ---------------------------------------------------------------- row keys

test('a meetings row key becomes a meeting_id', () => {
  assert.deepEqual(resolveReminderRowIds('4821'), { meetingId: 4821, legacyLeadId: null });
});

test('a legacy row key becomes a legacy_lead_id, never a meeting_id', () => {
  assert.deepEqual(resolveReminderRowIds('legacy_210456'), { meetingId: null, legacyLeadId: 210456 });
});

test('keys that identify neither table are stored without ids', () => {
  // row_key still goes in, so the hook works; only the join columns stay empty.
  assert.deepEqual(resolveReminderRowIds(''), { meetingId: null, legacyLeadId: null });
  assert.deepEqual(resolveReminderRowIds('staff-meeting'), { meetingId: null, legacyLeadId: null });
  assert.deepEqual(resolveReminderRowIds('legacy_abc'), { meetingId: null, legacyLeadId: null });
});

test('a non-integer or non-positive id is not treated as a meetings row', () => {
  assert.deepEqual(resolveReminderRowIds('0'), { meetingId: null, legacyLeadId: null });
  assert.deepEqual(resolveReminderRowIds('-5'), { meetingId: null, legacyLeadId: null });
  assert.deepEqual(resolveReminderRowIds('12.5'), { meetingId: null, legacyLeadId: null });
});

// ---------------------------------------------------------------- tooltip

test('the tooltip names every channel the reminder went out on', () => {
  const text = describeMeetingReminderMark({
    rowKey: '4821',
    lastSentAt: '2026-10-25T11:03:00.000Z',
    channels: ['whatsapp', 'email'],
    sentBy: 'Dana Cohen',
  });
  assert.match(text, /WhatsApp \+ Email reminder sent/);
  assert.match(text, /by Dana Cohen$/);
});

test('an unknown sender is left out rather than shown as empty', () => {
  const text = describeMeetingReminderMark({
    rowKey: '4821',
    lastSentAt: '2026-10-25T11:03:00.000Z',
    channels: ['whatsapp'],
    sentBy: null,
  });
  assert.match(text, /^WhatsApp reminder sent /);
  assert.doesNotMatch(text, /by/);
});

test('an unparseable timestamp is shown as stored instead of as Invalid Date', () => {
  const text = describeMeetingReminderMark({
    rowKey: '4821',
    lastSentAt: 'not-a-date',
    channels: ['email'],
    sentBy: null,
  });
  assert.equal(text, 'Email reminder sent not-a-date');
});
