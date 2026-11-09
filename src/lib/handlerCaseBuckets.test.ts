import test from 'node:test';
import assert from 'node:assert/strict';

import {
  classifyHandlerBucket,
  classifyOwnedHandlingBucket,
  classifyRetentionBucket,
  classifySupportBucket,
} from './handlerCaseBuckets';

test('case handler buckets by stage and ownership', () => {
  assert.equal(classifyHandlerBucket(200, 2, false), 'closed');
  assert.equal(classifyHandlerBucket(130, 1, false), 'non_active');
  assert.equal(classifyHandlerBucket(105, 2, false), 'new');
  assert.equal(classifyHandlerBucket(110, 2, false), 'active');
});

test('case handler counts nothing for an inactive, stageless or in-between case', () => {
  assert.equal(classifyHandlerBucket(130, 2, true), null);
  assert.equal(classifyHandlerBucket(null, 2, false), null);
  assert.equal(classifyHandlerBucket(107, 2, false), null);
});

test('a closed case stays closed even when inactive', () => {
  assert.equal(classifyHandlerBucket(200, 2, true), 'closed');
});

test('client support owns the case only when active_handler_type is 3', () => {
  assert.equal(classifySupportBucket(200, 3, false), 'closed');
  assert.equal(classifySupportBucket(130, 2, false), 'non_active');
  assert.equal(classifySupportBucket(130, 3, true), 'non_active');
  assert.equal(classifySupportBucket(105, 3, false), 'new');
  assert.equal(classifySupportBucket(110, 3, false), 'active');
  assert.equal(classifySupportBucket(107, 3, false), null);
  assert.equal(classifySupportBucket(null, 3, false), null);
});

test('a newer handling role owns the case only when its active type matches', () => {
  assert.equal(classifyOwnedHandlingBucket(200, 4, false, 4), 'closed');
  assert.equal(classifyOwnedHandlingBucket(130, 2, false, 4), 'non_active');
  assert.equal(classifyOwnedHandlingBucket(130, 4, true, 4), 'non_active');
  assert.equal(classifyOwnedHandlingBucket(105, 4, false, 4), 'new');
  assert.equal(classifyOwnedHandlingBucket(110, 5, false, 5), 'active');
  assert.equal(classifyOwnedHandlingBucket(107, 10, false, 10), null);
});

test('retention handler mirrors the case handler and reads the started flag', () => {
  assert.equal(classifyRetentionBucket(130, 2, false), 'non_active');
  assert.equal(classifyRetentionBucket(130, 3, false), 'non_active');
  assert.equal(classifyRetentionBucket(105, 1, false), 'new');
  assert.equal(classifyRetentionBucket(105, 1, true), 'active');
  assert.equal(classifyRetentionBucket(110, 1, false), 'active');
  assert.equal(classifyRetentionBucket(107, 1, false), null);
});

test('case handler treats client-support ownership as non-active', () => {
  assert.equal(classifyHandlerBucket(130, 3, false), 'non_active');
});
