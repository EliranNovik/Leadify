import assert from 'node:assert/strict';
import test from 'node:test';

import {
  blobsAreIdentical,
  encodeDrivePath,
  isOfficeEditableFile,
  officeEditDownloadUrl,
  officeEditStagingPath,
  officeEditWebUrl,
  officeEditableExtension,
  planUploadChunks,
  sanitiseOneDriveName,
  UPLOAD_CHUNK_BYTES,
} from './officeOnlineEdit';

test('only the XML Office formats can be edited', () => {
  assert.equal(isOfficeEditableFile('Agreement.docx'), true);
  assert.equal(isOfficeEditableFile('BUDGET.XLSX'), true);
  assert.equal(isOfficeEditableFile('deck.pptx'), true);
  // Word and Excel for the web would have to convert these first.
  assert.equal(isOfficeEditableFile('old-contract.doc'), false);
  assert.equal(isOfficeEditableFile('sheet.xls'), false);
  assert.equal(isOfficeEditableFile('passport.pdf'), false);
  assert.equal(isOfficeEditableFile(''), false);
  assert.equal(officeEditableExtension('Agreement.docx'), 'docx');
  assert.equal(officeEditableExtension('scan.jpg'), null);
});

test('names OneDrive would reject are cleaned up', () => {
  assert.equal(sanitiseOneDriveName('a/b:c*d?e"f<g>h|i.docx'), 'a-b-c-d-e-f-g-h-i.docx');
  assert.equal(sanitiseOneDriveName('  spaced   out .docx'), 'spaced out .docx');
  assert.equal(sanitiseOneDriveName('...hidden.docx'), 'hidden.docx');
  assert.equal(sanitiseOneDriveName(''), 'document');
});

test('each edit stages into its own folder', () => {
  assert.equal(
    officeEditStagingPath('abc-123', 'Power of attorney.docx'),
    'RMQ CRM edits/abc-123/Power of attorney.docx',
  );
  // A path separator in the name must not nest the file somewhere else.
  assert.equal(
    officeEditStagingPath('abc-123', 'cases/2026/file.xlsx'),
    'RMQ CRM edits/abc-123/cases-2026-file.xlsx',
  );
});

test('drive paths are encoded per segment, keeping the slashes', () => {
  assert.equal(
    encodeDrivePath('RMQ CRM edits/abc/Power of attorney.docx'),
    'RMQ%20CRM%20edits/abc/Power%20of%20attorney.docx',
  );
  assert.equal(encodeDrivePath('/leading/and/trailing/'), 'leading/and/trailing');
});

test('upload chunks cover the file exactly once', () => {
  assert.deepEqual(planUploadChunks(0), []);
  assert.deepEqual(planUploadChunks(10, 4), [
    { start: 0, end: 3 },
    { start: 4, end: 7 },
    { start: 8, end: 9 },
  ]);
  // An exact multiple must not produce a trailing empty chunk.
  assert.deepEqual(planUploadChunks(8, 4), [
    { start: 0, end: 3 },
    { start: 4, end: 7 },
  ]);

  const size = UPLOAD_CHUNK_BYTES * 2 + 17;
  const chunks = planUploadChunks(size);
  assert.equal(chunks.length, 3);
  assert.equal(chunks[0].start, 0);
  assert.equal(chunks[chunks.length - 1].end, size - 1);
  const total = chunks.reduce((sum, chunk) => sum + (chunk.end - chunk.start + 1), 0);
  assert.equal(total, size);
});

test('chunk size stays a multiple of 320 KiB, which upload sessions require', () => {
  assert.equal(UPLOAD_CHUNK_BYTES % (320 * 1024), 0);
});

test('the editor link opens the editor, not the reader', () => {
  assert.equal(
    officeEditWebUrl('https://tenant-my.sharepoint.com/personal/x/Doc.aspx?sourcedoc=1'),
    'https://tenant-my.sharepoint.com/personal/x/Doc.aspx?sourcedoc=1&action=edit',
  );
  assert.equal(officeEditWebUrl('https://host/file.docx'), 'https://host/file.docx?action=edit');
  // The webUrl OneDrive gives for an Office file leaves the mode up to the tenant.
  assert.equal(
    officeEditWebUrl('https://host/_layouts/15/Doc.aspx?sourcedoc=1&action=default&mobileredirect=true'),
    'https://host/_layouts/15/Doc.aspx?sourcedoc=1&action=edit&mobileredirect=true',
  );
  assert.equal(officeEditWebUrl(''), '');
});

test('an edit is spotted by comparing bytes, not length alone', async () => {
  assert.equal(await blobsAreIdentical(new Blob(['abc']), new Blob(['abc'])), true);
  // Same length, different content: exactly what a small edit to a document looks like.
  assert.equal(await blobsAreIdentical(new Blob(['abc']), new Blob(['abd'])), false);
  assert.equal(await blobsAreIdentical(new Blob(['abc']), new Blob(['abcd'])), false);
  assert.equal(await blobsAreIdentical(new Blob([]), new Blob([])), true);
  assert.equal(
    await blobsAreIdentical(new Blob([new Uint8Array([0, 255])]), new Blob([new Uint8Array([0, 254])])),
    false,
  );
});

test('the download link is read under either of its names', () => {
  assert.equal(officeEditDownloadUrl({ '@microsoft.graph.downloadUrl': 'https://a/1' }), 'https://a/1');
  assert.equal(officeEditDownloadUrl({ '@content.downloadUrl': 'https://a/2' }), 'https://a/2');
  assert.equal(officeEditDownloadUrl({ id: 'x' }), '');
  assert.equal(officeEditDownloadUrl(null), '');
});
