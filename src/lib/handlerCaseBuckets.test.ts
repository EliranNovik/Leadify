import test from 'node:test';
import assert from 'node:assert/strict';

import {
  classifyHandlerBucket,
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

test('client support goes by stage, with a parked lead as non-active', () => {
  assert.equal(classifySupportBucket(200, false), 'closed');
  assert.equal(classifySupportBucket(130, true), 'non_active');
  assert.equal(classifySupportBucket(105, false), 'new');
  assert.equal(classifySupportBucket(110, false), 'active');
  assert.equal(classifySupportBucket(107, false), null);
  assert.equal(classifySupportBucket(null, false), null);
});

test('retention handler mirrors the case handler and reads the started flag', () => {
  assert.equal(classifyRetentionBucket(130, 2, false), 'non_active');
  assert.equal(classifyRetentionBucket(105, 1, false), 'new');
  assert.equal(classifyRetentionBucket(105, 1, true), 'active');
  assert.equal(classifyRetentionBucket(110, 1, false), 'active');
  assert.equal(classifyRetentionBucket(107, 1, false), null);
});
