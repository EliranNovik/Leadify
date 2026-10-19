import test from 'node:test';
import assert from 'node:assert/strict';

import { clientMatchesLeadRouteKey } from './leadRouteMatch';

const NEW_LEAD = { id: '073e5418-5728-42aa-9596-367e2c9cf172', lead_number: 'L229882', lead_type: 'new' };
const LEGACY_LEAD = { id: 'legacy_210456', lead_number: '210456', lead_type: 'legacy' };

test('a new lead matches the lead number in the route', () => {
  assert.equal(clientMatchesLeadRouteKey(NEW_LEAD, 'L229882'), true);
});

test('a new lead also matches its uuid, which is what combine / direct links use', () => {
  assert.equal(clientMatchesLeadRouteKey(NEW_LEAD, '073e5418-5728-42aa-9596-367e2c9cf172'), true);
});

test('a different lead on the same page is not a match', () => {
  assert.equal(clientMatchesLeadRouteKey(NEW_LEAD, 'L229883'), false);
  assert.equal(clientMatchesLeadRouteKey(NEW_LEAD, '229882'), false);
});

test('a legacy lead matches the bare id, since the route drops the legacy_ prefix', () => {
  assert.equal(clientMatchesLeadRouteKey(LEGACY_LEAD, '210456'), true);
  assert.equal(clientMatchesLeadRouteKey(LEGACY_LEAD, 'legacy_210456'), false);
});

test('a legacy lead is recognised from the id prefix even without lead_type', () => {
  assert.equal(clientMatchesLeadRouteKey({ id: 'legacy_210456' }, '210456'), true);
});

test('a legacy sub-lead key is not matched against the master row', () => {
  // The master is loaded but the route asks for 210456/2, which is a different row.
  assert.equal(clientMatchesLeadRouteKey(LEGACY_LEAD, '210456/2'), false);
});

test('a new sub-lead matches its own slashed lead number', () => {
  const subLead = { id: 'c4f0a1d2-0000-4000-8000-000000000001', lead_number: 'L210764/3', lead_type: 'new' };
  assert.equal(clientMatchesLeadRouteKey(subLead, 'L210764/3'), true);
  assert.equal(clientMatchesLeadRouteKey(subLead, 'L210764'), false);
});

test('nothing in hand and nothing in the route are both misses, so the caller fetches', () => {
  assert.equal(clientMatchesLeadRouteKey(null, 'L229882'), false);
  assert.equal(clientMatchesLeadRouteKey(undefined, 'L229882'), false);
  assert.equal(clientMatchesLeadRouteKey(NEW_LEAD, ''), false);
  assert.equal(clientMatchesLeadRouteKey(NEW_LEAD, null), false);
});

test('an empty id or lead number never matches an empty-ish key', () => {
  assert.equal(clientMatchesLeadRouteKey({ id: '', lead_number: '', lead_type: 'new' }, '   '), false);
  assert.equal(clientMatchesLeadRouteKey({ id: 'legacy_', lead_type: 'legacy' }, ''), false);
});

test('surrounding whitespace in the route key is ignored', () => {
  assert.equal(clientMatchesLeadRouteKey(NEW_LEAD, ' L229882 '), true);
});

test('a numeric lead number given as a number still matches', () => {
  assert.equal(clientMatchesLeadRouteKey({ id: 'legacy_48213', lead_type: 'legacy' }, 48213), true);
});
