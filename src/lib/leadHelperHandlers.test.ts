import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildHelperHandlerRow,
  isHelperHandler,
  leadHelperHandlerIdentity,
  normalizeHelperHandlerIds,
} from './leadHelperHandlers';

const LEAD_UUID = '23116209-5afc-4da3-954e-3a53ef8bc59d';

test('a legacy client id is routed to the legacy lead key, not the uuid one', () => {
  assert.deepEqual(leadHelperHandlerIdentity('legacy_48213'), {
    legacyLeadId: 48213,
    newLeadId: null,
  });
  assert.deepEqual(leadHelperHandlerIdentity(LEAD_UUID), {
    legacyLeadId: null,
    newLeadId: LEAD_UUID,
  });
});

test('an assignment fills exactly one lead key', () => {
  /*
   * The table rejects a row with both keys or neither, so getting this wrong is a failed insert
   * rather than a row saved against the wrong lead. Pinned because the prefix stripping is the only
   * thing standing between a legacy id and the uuid column.
   */
  const fromNew = buildHelperHandlerRow(LEAD_UUID, 19, 'Ariel');
  assert.deepEqual(fromNew, {
    new_lead_id: LEAD_UUID,
    legacy_lead_id: null,
    employee_id: 19,
    created_by: 'Ariel',
  });

  const fromLegacy = buildHelperHandlerRow('legacy_48213', '43');
  assert.deepEqual(fromLegacy, {
    new_lead_id: null,
    legacy_lead_id: 48213,
    employee_id: 43,
    created_by: null,
  });
});

test('an assignment that identifies neither a lead nor an employee is refused', () => {
  // Returning null rather than a half-filled row is what stops the insert from being attempted.
  assert.equal(buildHelperHandlerRow('', 19), null);
  assert.equal(buildHelperHandlerRow(null, 19), null);
  assert.equal(buildHelperHandlerRow('legacy_not-a-number', 19), null);
  assert.equal(buildHelperHandlerRow(LEAD_UUID, null), null);
  assert.equal(buildHelperHandlerRow(LEAD_UUID, 0), null);
  assert.equal(buildHelperHandlerRow(LEAD_UUID, 'Ariel'), null);
});

test('the displayed list matches the order the lead row stores', () => {
  /*
   * The trigger writes the ids sorted, so sorting here is what keeps the card and anything reading
   * `helper_handler_ids` showing the same people in the same order.
   */
  assert.deepEqual(normalizeHelperHandlerIds([43, 19, 61]), [19, 43, 61]);
  assert.deepEqual(normalizeHelperHandlerIds(['43', 19, '61']), [19, 43, 61]);
});

test('the same employee cannot appear twice in the list', () => {
  // Matches the unique index: holding the role twice is not a thing the UI should be able to show.
  assert.deepEqual(normalizeHelperHandlerIds([19, 19, '19', 43]), [19, 43]);
});

test('values that are not employee ids are dropped rather than shown as people', () => {
  assert.deepEqual(normalizeHelperHandlerIds([null, undefined, '', 'Ariel', 0, -5, NaN, 19]), [19]);
  assert.deepEqual(normalizeHelperHandlerIds([]), []);
});

test('someone already holding the role is kept out of the picker', () => {
  const assigned = [19, 43];
  assert.equal(isHelperHandler(assigned, 19), true);
  // The dropdown hands back employee ids from Supabase, which arrive as strings often enough.
  assert.equal(isHelperHandler(assigned, '43'), true);
  assert.equal(isHelperHandler(assigned, 61), false);
  assert.equal(isHelperHandler(assigned, null), false);
  assert.equal(isHelperHandler([], 19), false);
});
