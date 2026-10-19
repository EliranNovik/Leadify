import test from 'node:test';
import assert from 'node:assert/strict';

import { MEETING_HEADER_COLORS, resolveMeetingHeaderKind } from './meetingHeaderColors';

test('client meetings are told apart by calendar_type', () => {
  assert.equal(resolveMeetingHeaderKind('active_client'), 'active_client');
  assert.equal(resolveMeetingHeaderKind('potential_client'), 'potential_client');
});

test('an unknown or missing calendar_type reads as a potential client, as the badge does', () => {
  assert.equal(resolveMeetingHeaderKind(null), 'potential_client');
  assert.equal(resolveMeetingHeaderKind(undefined), 'potential_client');
  assert.equal(resolveMeetingHeaderKind(''), 'potential_client');
});

test('a staff meeting with only staff participants is internal', () => {
  assert.equal(
    resolveMeetingHeaderKind('staff', [{ type: 'staff' }, { type: 'staff' }]),
    'internal_meeting',
  );
  assert.equal(resolveMeetingHeaderKind('recruitment', []), 'internal_meeting');
});

test('a staff meeting is external once a firm contact or a free participant is invited', () => {
  assert.equal(resolveMeetingHeaderKind('staff', [{ type: 'staff' }, { type: 'firm' }]), 'external_meeting');
  assert.equal(resolveMeetingHeaderKind('staff', [{ type: 'extern' }]), 'external_meeting');
});

test('participants that have not loaded yet leave a staff meeting internal', () => {
  assert.equal(resolveMeetingHeaderKind('staff'), 'internal_meeting');
  assert.equal(resolveMeetingHeaderKind('staff', null), 'internal_meeting');
});

test('outside participants on a client meeting do not change its kind', () => {
  assert.equal(resolveMeetingHeaderKind('active_client', [{ type: 'firm' }]), 'active_client');
});

test('the four kinds get four different colours', () => {
  const colors = Object.values(MEETING_HEADER_COLORS);
  assert.equal(new Set(colors).size, colors.length);
  colors.forEach((color) => assert.match(color, /^#[0-9A-F]{6}$/i));
});
