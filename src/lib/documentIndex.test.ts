import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DOCUMENT_INDEX_PAGE_SIZE,
  hasStoredFile,
  nextDocumentIndexPage,
  type DocumentIndexRow,
} from './documentIndex';

function row(overrides: Partial<DocumentIndexRow> = {}): DocumentIndexRow {
  return {
    source: 'lead',
    row_id: 'r1',
    file_name: 'passport.pdf',
    storage_bucket: 'lead-sub-efforts-documents',
    storage_path: 'L1/passport.pdf',
    mime_type: 'application/pdf',
    file_size: 1024,
    uploaded_by: 'Anna',
    created_at: '2026-10-01T10:00:00Z',
    folder_id: null,
    folder_path: null,
    scope_key: 'L1',
    scope_label: 'L1',
    category: null,
    ai_summary: null,
    classification_id: null,
    area: null,
    ...overrides,
  };
}

test('reads the page after this one while rows remain', () => {
  assert.equal(nextDocumentIndexPage(0, 6940), 1);
  assert.equal(nextDocumentIndexPage(3, 6940), 4);
});

test('stops at the last page a store actually holds', () => {
  // 52 rows fill page 0 and two rows of page 1; page 2 starts past the final row, which the
  // store answers with 'Requested range not satisfiable' rather than with an empty page.
  assert.equal(nextDocumentIndexPage(0, 52), 1);
  assert.equal(nextDocumentIndexPage(1, 52), 1);
  assert.equal(nextDocumentIndexPage(9, 52), 1);
});

test('asks for nothing beyond the first page when one page holds everything', () => {
  assert.equal(nextDocumentIndexPage(0, DOCUMENT_INDEX_PAGE_SIZE), 0);
  assert.equal(nextDocumentIndexPage(0, 1), 0);
  assert.equal(nextDocumentIndexPage(0, 0), 0);
});

test('an exact multiple of the page size has no page after its last full one', () => {
  assert.equal(nextDocumentIndexPage(0, 100), 1);
  assert.equal(nextDocumentIndexPage(1, 100), 1);
});

test('a count that is somehow negative still asks for a valid page', () => {
  assert.equal(nextDocumentIndexPage(0, -1), 0);
});

test('a document with a stored file can be copied or moved', () => {
  assert.equal(hasStoredFile(row()), true);
});

test('a document whose upload never finished has no file to copy', () => {
  assert.equal(hasStoredFile(row({ storage_path: 'pending' })), false);
  assert.equal(hasStoredFile(row({ storage_path: '  ' })), false);
  assert.equal(hasStoredFile(row({ storage_bucket: '' })), false);
});
