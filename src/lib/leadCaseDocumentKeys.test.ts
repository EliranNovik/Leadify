import assert from 'node:assert/strict';
import test from 'node:test';

import { expandLeadCaseDocumentLeadNumbers } from './leadCaseDocumentKeys';
import { dedupeCaseRowsByStoragePath } from './sequenceOfEventsDocuments';

const keys = (...raws: Array<string | null | undefined>) =>
  new Set(expandLeadCaseDocumentLeadNumbers(...raws));

test('a prefixed lead number also matches the bare number', () => {
  const result = keys('L123');
  assert.ok(result.has('L123'));
  assert.ok(result.has('123'));
  assert.ok(result.has('C123'));
});

test('a bare legacy id also matches the prefixed and master spellings', () => {
  // Smart Scan files a legacy lead under its bare id; the client page shows it as L123 or 123/1.
  const result = keys('123');
  assert.ok(result.has('123'));
  assert.ok(result.has('L123'));
  assert.ok(result.has('123/1'));
  assert.ok(result.has('L123/1'));
});

test('a master lead number also matches rows filed without the /1', () => {
  const result = keys('123/1');
  assert.ok(result.has('123/1'));
  assert.ok(result.has('L123/1'));
  assert.ok(result.has('123'));
  assert.ok(result.has('L123'));
});

test('a sub-lead does not reach the other sub-leads or the master', () => {
  const result = keys('123/2');
  assert.ok(result.has('123/2'));
  assert.ok(result.has('L123/2'));
  assert.ok(!result.has('123'));
  assert.ok(!result.has('123/1'));
  assert.ok(!result.has('123/3'));
});

test('empty and missing values contribute nothing', () => {
  assert.deepEqual(expandLeadCaseDocumentLeadNumbers('', null, undefined), []);
});

test('several sources are expanded into one list', () => {
  const result = keys('L123', '456');
  assert.ok(result.has('123'));
  assert.ok(result.has('L456'));
});

test('the same file filed under two lead spellings is listed once, newest kept', () => {
  const rows = [
    { id: 'new', storage_path: 'case-documents/123/ClientHeaderDocuments/scan.pdf' },
    { id: 'old', storage_path: '/case-documents/123/ClientHeaderDocuments/scan.pdf' },
    { id: 'other', storage_path: 'case-documents/123/ClientHeaderDocuments/other.pdf' },
  ];
  assert.deepEqual(
    dedupeCaseRowsByStoragePath(rows).map((r) => r.id),
    ['new', 'other'],
  );
});

test('rows without a usable path are all kept', () => {
  const rows = [
    { id: 'a', storage_path: '' },
    { id: 'b', storage_path: '   ' },
  ];
  assert.deepEqual(
    dedupeCaseRowsByStoragePath(rows).map((r) => r.id),
    ['a', 'b'],
  );
});
