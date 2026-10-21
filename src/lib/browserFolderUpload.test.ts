import test from 'node:test';
import assert from 'node:assert/strict';

import {
  MAX_FOLDER_UPLOAD_FILES,
  entriesFromDirectoryInput,
  expandDroppedItems,
  isIgnoredUploadName,
  planFolderUpload,
  planHasFolders,
  readDroppedItems,
  type FileSystemEntryLike,
} from './browserFolderUpload';

const fakeFile = (name: string): File => ({ name, size: 10, type: 'application/pdf' }) as unknown as File;

const fileEntry = (name: string): FileSystemEntryLike => ({
  name,
  isFile: true,
  isDirectory: false,
  file: (onFile) => onFile(fakeFile(name)),
});

const dirEntry = (name: string, children: FileSystemEntryLike[]): FileSystemEntryLike => ({
  name,
  isFile: false,
  isDirectory: true,
  createReader: () => {
    let done = false;
    return {
      // The real API hands back batches and then an empty array, so mimic that.
      readEntries: (onEntries) => {
        if (done) {
          onEntries([]);
          return;
        }
        done = true;
        onEntries(children);
      },
    };
  },
});

test('a dropped folder tree keeps the folder names above each file', async () => {
  const tree = dirEntry('passports', [
    fileEntry('cover.pdf'),
    dirEntry('2026', [fileEntry('scan.pdf'), fileEntry('scan-2.pdf')]),
  ]);

  const entries = await expandDroppedItems([{ entry: tree, file: null }]);

  assert.deepEqual(
    entries.map((entry) => [...entry.segments, entry.file.name].join('/')),
    ['passports/cover.pdf', 'passports/2026/scan.pdf', 'passports/2026/scan-2.pdf'],
  );
});

test('plain files dropped alongside a folder stay at the root', async () => {
  const entries = await expandDroppedItems([
    { entry: null, file: fakeFile('loose.pdf') },
    { entry: dirEntry('contracts', [fileEntry('signed.pdf')]), file: null },
  ]);

  assert.deepEqual(entries[0].segments, []);
  assert.equal(entries[0].file.name, 'loose.pdf');
  assert.deepEqual(entries[1].segments, ['contracts']);
});

test('operating system clutter is left behind', async () => {
  const entries = await expandDroppedItems([
    { entry: dirEntry('passports', [fileEntry('.DS_Store'), fileEntry('real.pdf')]), file: null },
    { entry: dirEntry('__MACOSX', [fileEntry('ignored.pdf')]), file: null },
  ]);

  assert.deepEqual(
    entries.map((entry) => entry.file.name),
    ['real.pdf'],
  );
  assert.ok(isIgnoredUploadName('._resume.pdf'));
  assert.ok(!isIgnoredUploadName('resume.pdf'));
});

test('a folder nested deeper than the cap stops rather than runs away', async () => {
  let deepest: FileSystemEntryLike = dirEntry('level-12', [fileEntry('too-deep.pdf')]);
  for (let level = 11; level >= 1; level -= 1) {
    deepest = dirEntry(`level-${level}`, [deepest]);
  }

  const entries = await expandDroppedItems([{ entry: deepest, file: null }]);

  assert.equal(entries.length, 0);
});

test('an input with webkitdirectory reports the folders from the relative path', () => {
  const withPath = (name: string, relative: string) =>
    ({ name, webkitRelativePath: relative, size: 1 }) as unknown as File;

  const entries = entriesFromDirectoryInput([
    withPath('scan.pdf', 'passports/2026/scan.pdf'),
    withPath('cover.pdf', 'passports/cover.pdf'),
    withPath('.DS_Store', 'passports/.DS_Store'),
  ]);

  assert.equal(entries.length, 2);
  assert.deepEqual(entries[0].segments, ['passports', '2026']);
  assert.deepEqual(entries[1].segments, ['passports']);
});

test('the plan lists every folder to create, parents before children', () => {
  const plan = planFolderUpload([
    { file: fakeFile('scan.pdf'), segments: ['passports', '2026'] },
    { file: fakeFile('other.pdf'), segments: ['passports', '2025'] },
    { file: fakeFile('loose.pdf'), segments: [] },
  ]);

  assert.deepEqual(plan.folderPaths, [
    ['passports'],
    ['passports', '2026'],
    ['passports', '2025'],
  ]);
  assert.ok(planHasFolders(plan));
  assert.equal(plan.droppedForLimit, 0);
});

test('a flat drop asks for no folders at all', () => {
  const plan = planFolderUpload([{ file: fakeFile('one.pdf'), segments: [] }]);
  assert.deepEqual(plan.folderPaths, []);
  assert.ok(!planHasFolders(plan));
});

test('folder names are tidied and the file cap is reported, not hidden', () => {
  const plan = planFolderUpload([
    { file: fakeFile('a.pdf'), segments: ['  spaced   out  ', '..', ''] },
  ]);
  assert.deepEqual(plan.entries[0].segments, ['spaced out']);

  const tooMany = Array.from({ length: MAX_FOLDER_UPLOAD_FILES + 5 }, (_, index) => ({
    file: fakeFile(`file-${index}.pdf`),
    segments: ['bulk'],
  }));
  const capped = planFolderUpload(tooMany);
  assert.equal(capped.entries.length, MAX_FOLDER_UPLOAD_FILES);
  assert.equal(capped.droppedForLimit, 5);
});

test('a drop is read through items so folders are visible, with files as the fallback', () => {
  const entry = dirEntry('passports', []);
  const fromItems = readDroppedItems({
    items: [
      { webkitGetAsEntry: () => entry, getAsFile: () => null } as unknown as DataTransferItem,
    ],
    files: [fakeFile('ignored-because-items-win.pdf')],
  });
  assert.equal(fromItems.length, 1);
  assert.equal(fromItems[0].entry, entry);

  const fromFiles = readDroppedItems({ items: [], files: [fakeFile('only.pdf')] });
  assert.equal(fromFiles.length, 1);
  assert.equal(fromFiles[0].entry, null);
  assert.equal(fromFiles[0].file?.name, 'only.pdf');
});
