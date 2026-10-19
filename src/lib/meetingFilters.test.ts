import test from 'node:test';
import assert from 'node:assert/strict';

import {
  EMPTY_MEETING_FILTERS,
  hasActiveMeetingFilters,
  meetingMatchesFilters,
} from './meetingFilters';

test('with no filters set everything matches', () => {
  assert.equal(hasActiveMeetingFilters(EMPTY_MEETING_FILTERS), false);
  assert.equal(
    meetingMatchesFilters({ date: '2026-10-20' }, 'active_client', EMPTY_MEETING_FILTERS),
    true,
  );
  assert.equal(meetingMatchesFilters({ date: null }, 'internal_meeting', EMPTY_MEETING_FILTERS), true);
});

test('any one filter counts as active', () => {
  assert.equal(hasActiveMeetingFilters({ ...EMPTY_MEETING_FILTERS, dateFrom: '2026-10-01' }), true);
  assert.equal(hasActiveMeetingFilters({ ...EMPTY_MEETING_FILTERS, dateTo: '2026-10-01' }), true);
  assert.equal(hasActiveMeetingFilters({ ...EMPTY_MEETING_FILTERS, kind: 'external_meeting' }), true);
});

test('the range includes both of its end days', () => {
  const filters = { ...EMPTY_MEETING_FILTERS, dateFrom: '2026-10-10', dateTo: '2026-10-20' };
  assert.equal(meetingMatchesFilters({ date: '2026-10-10' }, 'active_client', filters), true);
  assert.equal(meetingMatchesFilters({ date: '2026-10-20' }, 'active_client', filters), true);
  assert.equal(meetingMatchesFilters({ date: '2026-10-09' }, 'active_client', filters), false);
  assert.equal(meetingMatchesFilters({ date: '2026-10-21' }, 'active_client', filters), false);
});

test('an open-ended range filters on one side only', () => {
  const from = { ...EMPTY_MEETING_FILTERS, dateFrom: '2026-10-10' };
  assert.equal(meetingMatchesFilters({ date: '2026-12-31' }, 'active_client', from), true);
  assert.equal(meetingMatchesFilters({ date: '2026-01-01' }, 'active_client', from), false);

  const to = { ...EMPTY_MEETING_FILTERS, dateTo: '2026-10-10' };
  assert.equal(meetingMatchesFilters({ date: '2026-01-01' }, 'active_client', to), true);
  assert.equal(meetingMatchesFilters({ date: '2026-12-31' }, 'active_client', to), false);
});

test('a timestamp is compared by its day', () => {
  const filters = { ...EMPTY_MEETING_FILTERS, dateFrom: '2026-10-10', dateTo: '2026-10-10' };
  assert.equal(meetingMatchesFilters({ date: '2026-10-10T14:30:00Z' }, 'active_client', filters), true);
});

test('a meeting without a date is hidden by a range but kept by a type filter', () => {
  const range = { ...EMPTY_MEETING_FILTERS, dateFrom: '2026-10-10' };
  assert.equal(meetingMatchesFilters({ date: '' }, 'active_client', range), false);
  assert.equal(meetingMatchesFilters({}, 'active_client', range), false);

  const kind = { ...EMPTY_MEETING_FILTERS, kind: 'active_client' as const };
  assert.equal(meetingMatchesFilters({ date: '' }, 'active_client', kind), true);
});

test('the type filter keeps only its own kind', () => {
  const filters = { ...EMPTY_MEETING_FILTERS, kind: 'external_meeting' as const };
  assert.equal(meetingMatchesFilters({ date: '2026-10-20' }, 'external_meeting', filters), true);
  assert.equal(meetingMatchesFilters({ date: '2026-10-20' }, 'internal_meeting', filters), false);
  assert.equal(meetingMatchesFilters({ date: '2026-10-20' }, 'active_client', filters), false);
});

test('date and type filters apply together', () => {
  const filters = { dateFrom: '2026-10-10', dateTo: '2026-10-20', kind: 'active_client' as const };
  assert.equal(meetingMatchesFilters({ date: '2026-10-15' }, 'active_client', filters), true);
  assert.equal(meetingMatchesFilters({ date: '2026-10-15' }, 'potential_client', filters), false);
  assert.equal(meetingMatchesFilters({ date: '2026-10-25' }, 'active_client', filters), false);
});
