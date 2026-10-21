import test from 'node:test';
import assert from 'node:assert/strict';
import { selectMainDepartments } from './mainDepartments';

test('orders departments by id and drops sales sub-departments', () => {
  const result = selectMainDepartments([
    { id: 7, name: 'Austrian Citizenship' },
    { id: 12, name: 'Sales - Tel Aviv' },
    { id: 3, name: 'German Citizenship' },
    { id: 15, name: 'Sales - Online' },
  ]);

  assert.deepEqual(result, [
    { id: 3, name: 'German Citizenship' },
    { id: 7, name: 'Austrian Citizenship' },
  ]);
});

test('adds merged target departments that are not flagged important', () => {
  const result = selectMainDepartments(
    [{ id: 7, name: 'Austrian Citizenship' }],
    [
      { id: 4, name: 'Immigration Israel' },
      { id: 7, name: 'Austrian Citizenship (duplicate)' },
    ],
  );

  assert.deepEqual(result, [
    { id: 4, name: 'Immigration Israel' },
    { id: 7, name: 'Austrian Citizenship' },
  ]);
});

test('department 20 takes the Commercial & Civil name and the other one goes', () => {
  const result = selectMainDepartments([
    { id: 9, name: 'Commercial & Civil' },
    { id: 11, name: 'Commercial - Sales' },
    { id: 20, name: 'Commercial' },
  ]);

  assert.deepEqual(result, [{ id: 20, name: 'Commercial & Civil' }]);
});

test('keeps a Commercial & Civil department when id 20 is absent', () => {
  const result = selectMainDepartments([{ id: 9, name: 'Commercial & Civil' }]);
  assert.deepEqual(result, [{ id: 9, name: 'Commercial & Civil' }]);
});

test('skips rows without a usable name', () => {
  const result = selectMainDepartments([
    { id: 5, name: '  ' },
    { id: 6, name: null },
    { id: 8, name: 'Finance' },
  ]);

  assert.deepEqual(result, [{ id: 8, name: 'Finance' }]);
});
