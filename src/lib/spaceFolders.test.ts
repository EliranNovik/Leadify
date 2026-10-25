import test from 'node:test';
import assert from 'node:assert/strict';

import {
  findSpaceFolderChild,
  MAX_SPACE_FOLDER_DEPTH,
  normaliseSpaceFolderTitle,
  orderSpaceFolders,
  spaceFolderChildren,
  spaceFolderDepth,
  spaceFolderLabel,
  spaceFolderPath,
  spaceFolderSegmentsToCreate,
  spaceFolderTrail,
  type SpaceFolderNode,
} from './spaceFolders';

const folder = (id: string, title: string, parent_id: string | null = null): SpaceFolderNode => ({
  id,
  title,
  parent_id,
});

/** Reports / 2026 / Q1, plus an unrelated root. */
const tree: SpaceFolderNode[] = [
  folder('reports', 'Reports'),
  folder('y2026', '2026', 'reports'),
  folder('q1', 'Q1', 'y2026'),
  folder('passports', 'Passports'),
];

test('a path segment loses the characters that would read as another level', () => {
  assert.equal(normaliseSpaceFolderTitle('  Reports/2026  '), 'Reports 2026');
  assert.equal(normaliseSpaceFolderTitle('a\\b'), 'a b');
  assert.equal(normaliseSpaceFolderTitle('   '), '');
  assert.equal(normaliseSpaceFolderTitle('x'.repeat(200)).length, 80);
});

test('children are read per parent, with the roots under null', () => {
  assert.deepEqual(
    spaceFolderChildren(tree, null).map((item) => item.id),
    ['reports', 'passports'],
  );
  assert.deepEqual(
    spaceFolderChildren(tree, 'reports').map((item) => item.id),
    ['y2026'],
  );
  assert.deepEqual(spaceFolderChildren(tree, 'q1'), []);
});

test('a child is matched by title whatever its case or padding', () => {
  assert.equal(findSpaceFolderChild(tree, 'reports', '2026')?.id, 'y2026');
  assert.equal(findSpaceFolderChild(tree, 'y2026', ' q1 ')?.id, 'q1');
  assert.equal(findSpaceFolderChild(tree, null, 'REPORTS')?.id, 'reports');
  // Only within the same parent — Q1 is not a root.
  assert.equal(findSpaceFolderChild(tree, null, 'Q1'), undefined);
});

test('the trail runs root first, and the depth follows it', () => {
  assert.deepEqual(
    spaceFolderTrail(tree, 'q1').map((item) => item.title),
    ['Reports', '2026', 'Q1'],
  );
  assert.equal(spaceFolderPath(tree, 'q1'), 'Reports / 2026 / Q1');
  assert.equal(spaceFolderDepth(tree, 'q1'), 2);
  assert.equal(spaceFolderDepth(tree, 'reports'), 0);
  assert.equal(spaceFolderDepth(tree, null), 0);
});

test('an unknown folder has no trail at all', () => {
  assert.deepEqual(spaceFolderTrail(tree, 'gone'), []);
  assert.equal(spaceFolderPath(tree, 'gone'), '');
});

test('a folder whose parent is missing still reports itself', () => {
  const orphan = [folder('child', 'Child', 'missing-parent')];
  assert.deepEqual(
    spaceFolderTrail(orphan, 'child').map((item) => item.id),
    ['child'],
  );
  // And it is listed rather than hidden, so its files stay reachable.
  assert.deepEqual(
    orderSpaceFolders(orphan).map((item) => [item.folder.id, item.depth]),
    [['child', 0]],
  );
});

test('a flat list names a nested folder by its path and a root one by its title', () => {
  assert.equal(spaceFolderLabel(tree, tree[0]), 'Reports');
  assert.equal(spaceFolderLabel(tree, tree[2]), 'Reports / 2026 / Q1');
});

test('ordering puts each folder under its parent with a depth to indent by', () => {
  assert.deepEqual(
    orderSpaceFolders(tree).map((item) => [item.folder.title, item.depth]),
    [
      ['Reports', 0],
      ['2026', 1],
      ['Q1', 2],
      ['Passports', 0],
    ],
  );
});

test('a dropped path is cleaned up before any folder is created', () => {
  assert.deepEqual(
    spaceFolderSegmentsToCreate(tree, ['  Reports ', '', '2026/2027']),
    ['Reports', '2026 2027'],
  );
  assert.deepEqual(spaceFolderSegmentsToCreate(tree, []), []);
  assert.deepEqual(spaceFolderSegmentsToCreate(tree, ['  ']), []);
});

test('a path is cut off at the depth limit, counted from where it is dropped', () => {
  const deep = Array.from({ length: MAX_SPACE_FOLDER_DEPTH + 3 }, (_, i) => `L${i}`);
  assert.equal(spaceFolderSegmentsToCreate(tree, deep).length, MAX_SPACE_FOLDER_DEPTH);
  // Dropped into Q1, which is already two levels down, three levels are left.
  assert.equal(
    spaceFolderSegmentsToCreate(tree, deep, 'q1').length,
    MAX_SPACE_FOLDER_DEPTH - 3,
  );
});
