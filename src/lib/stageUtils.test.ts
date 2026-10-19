import test from 'node:test';
import assert from 'node:assert/strict';

import { allowsAdditionalLeadMeetings, applyLocalLeadStage, preferNewerLeadStage } from './stageUtils';

const EARLIER = '2026-10-14T08:00:00.000Z';
const LATER = '2026-10-14T09:00:00.000Z';

test('a locally set stage is stamped so a refetch can tell it is the newer one', () => {
  const patched = applyLocalLeadStage({ id: 'legacy_48213', stage: 60, stage_changed_at: EARLIER }, 105, LATER);
  assert.equal(patched.stage, 105);
  assert.equal(patched.stage_changed_at, LATER);
});

test('the stage labels are cleared rather than kept from the stage that was replaced', () => {
  const patched = applyLocalLeadStage(
    { stage: 60, stage_name: 'Meeting scheduled', stage_colour: '#ff0000' },
    105,
    LATER,
  );
  assert.equal(patched.stage_name, null);
  assert.equal(patched.stage_colour, null);
});

test('the rest of the lead is left alone', () => {
  const patched = applyLocalLeadStage({ id: 'abc', name: 'Jane', balance: '100', stage: 60 }, 105, LATER);
  assert.equal(patched.id, 'abc');
  assert.equal(patched.name, 'Jane');
  assert.equal(patched.balance, '100');
});

test('who changed the stage is recorded when we know, and not invented when we do not', () => {
  const withActor = applyLocalLeadStage({ stage: 60 }, 105, LATER, 'Anna Zh');
  assert.equal(withActor.stage_changed_by, 'Anna Zh');
  const withoutActor = applyLocalLeadStage({ stage: 60, stage_changed_by: 'Anna Zh' }, 105, LATER);
  assert.equal(withoutActor.stage_changed_by, 'Anna Zh', 'an unknown actor must not wipe the last known one');
});

test('the stamp defaults to now, so a caller that forgets one still beats an older snapshot', () => {
  const before = Date.now();
  const patched = applyLocalLeadStage({ stage: 60, stage_changed_at: EARLIER }, 105);
  const stamped = Date.parse(String(patched.stage_changed_at));
  assert.ok(stamped >= before, 'the default stamp should not be older than the call');
  assert.ok(stamped > Date.parse(EARLIER));
});

test('a refetch that was in flight with the previous stage cannot roll a local change back', () => {
  const local = applyLocalLeadStage({ id: 'abc', stage: 60, stage_changed_at: EARLIER }, 105, LATER);
  // The refetch started before the change landed, so it still carries the old stage and old stamp.
  const refetched = { id: 'abc', stage: 60, stage_changed_at: EARLIER, name: 'Jane' };
  const merged = preferNewerLeadStage(local, { ...local, ...refetched });
  assert.equal(merged.stage, 105, 'the stage the user just set must survive the refetch');
  assert.equal(merged.stage_changed_at, LATER);
  assert.equal(merged.name, 'Jane', 'everything else on the refetched row still comes through');
});

test('a genuinely newer stage from the server wins', () => {
  const local = applyLocalLeadStage({ id: 'abc', stage: 60, stage_changed_at: EARLIER }, 105, EARLIER);
  const merged = preferNewerLeadStage(local, { ...local, stage: 40, stage_changed_at: LATER });
  assert.equal(merged.stage, 40);
  assert.equal(merged.stage_changed_at, LATER);
});

test('an unstamped local patch loses to the refetch, which is why the stamp exists', () => {
  const unstamped = { id: 'abc', stage: 105, stage_changed_at: EARLIER };
  const merged = preferNewerLeadStage(unstamped, { id: 'abc', stage: 60, stage_changed_at: EARLIER });
  assert.equal(merged.stage, 60);
});

test('when the local stage is kept, a label describing the other stage is dropped', () => {
  const local = applyLocalLeadStage({ id: 'abc', stage: 60, stage_changed_at: EARLIER }, 105, LATER);
  const merged = preferNewerLeadStage(local, {
    ...local,
    stage: 60,
    stage_changed_at: EARLIER,
    stage_name: 'Meeting scheduled',
    stage_colour: '#ff0000',
  });
  assert.equal(merged.stage, 105);
  assert.equal(merged.stage_name, null, 'the name belonged to stage 60, not to 105');
  assert.equal(merged.stage_colour, null);
});

test('a label for the same stage is kept when the refetch has one and we do not', () => {
  const local = { id: 'abc', stage: 105, stage_changed_at: LATER, stage_name: null, stage_colour: null };
  const merged = preferNewerLeadStage(local, {
    ...local,
    stage_changed_at: EARLIER,
    stage_name: 'Client signed',
    stage_colour: '#00ff00',
  });
  assert.equal(merged.stage, 105);
  assert.equal(merged.stage_name, 'Client signed');
  assert.equal(merged.stage_colour, '#00ff00');
});

test('a first load has nothing to compare against, so the fetched row is taken as is', () => {
  const fetched = { id: 'abc', stage: 60, stage_changed_at: EARLIER };
  assert.equal(preferNewerLeadStage(null, fetched).stage, 60);
  assert.equal(preferNewerLeadStage({ id: 'abc', stage: null }, fetched).stage, 60);
});

test('two rows with no stamp at all leave the fetched stage in place', () => {
  // Legacy rows can have no stage_changed_at on either side; the server copy must still win.
  const merged = preferNewerLeadStage({ id: 'abc', stage: 60 }, { id: 'abc', stage: 105 });
  assert.equal(merged.stage, 105);
});

test('a signed case can book more meetings, from stage 60 onwards', () => {
  assert.equal(allowsAdditionalLeadMeetings(60), true, 'Client signed agreement');
  assert.equal(allowsAdditionalLeadMeetings(70), true, 'Payment request sent');
  assert.equal(allowsAdditionalLeadMeetings(100), true, 'Success');
  assert.equal(allowsAdditionalLeadMeetings(105), true, 'Handler Set');
  assert.equal(allowsAdditionalLeadMeetings(110), true, 'Handler Started');
  assert.equal(allowsAdditionalLeadMeetings(150), true, 'Application submitted');
});

test('before signing the stage buttons still drive one meeting at a time', () => {
  assert.equal(allowsAdditionalLeadMeetings(0), false, 'Created');
  assert.equal(allowsAdditionalLeadMeetings(20), false, 'Meeting scheduled');
  assert.equal(allowsAdditionalLeadMeetings(40), false, 'Waiting for Mtng sum');
  assert.equal(allowsAdditionalLeadMeetings(50), false, 'Mtng sum+Agreement sent');
  assert.equal(allowsAdditionalLeadMeetings(55), false, 'Another meeting');
});

test('a dropped lead is a dead end, not a case to book meetings on', () => {
  assert.equal(allowsAdditionalLeadMeetings(91), false);
  assert.equal(allowsAdditionalLeadMeetings('91'), false);
});

test('the stage can arrive as a string or a name', () => {
  assert.equal(allowsAdditionalLeadMeetings('105'), true);
  assert.equal(allowsAdditionalLeadMeetings('Client signed agreement'), true);
  assert.equal(allowsAdditionalLeadMeetings('Meeting scheduled'), false);
});

test('a missing stage does not unlock extra meetings', () => {
  assert.equal(allowsAdditionalLeadMeetings(null), false);
  assert.equal(allowsAdditionalLeadMeetings(undefined), false);
  assert.equal(allowsAdditionalLeadMeetings(''), false);
});
