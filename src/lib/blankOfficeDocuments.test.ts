import assert from 'node:assert/strict';
import test from 'node:test';

import { blankOfficeFileName, blankOfficeSpec } from './blankOfficeDocuments';

test('a new document gets the right extension exactly once', () => {
  assert.equal(blankOfficeFileName('word', 'Power of attorney'), 'Power of attorney.docx');
  assert.equal(blankOfficeFileName('excel', 'Costs'), 'Costs.xlsx');
  // Typing the extension too should not double it, whatever case it is in.
  assert.equal(blankOfficeFileName('word', 'Draft.docx'), 'Draft.docx');
  assert.equal(blankOfficeFileName('word', 'Draft.DOCX'), 'Draft.docx');
  // A different extension is part of the name, not a replacement.
  assert.equal(blankOfficeFileName('word', 'Draft.pdf'), 'Draft.pdf.docx');
});

test('names that storage or OneDrive would reject are cleaned up', () => {
  assert.equal(blankOfficeFileName('excel', 'a/b:c*d?e"f<g>h|i'), 'a-b-c-d-e-f-g-h-i.xlsx');
  assert.equal(blankOfficeFileName('word', '  spaced   out  '), 'spaced out.docx');
  assert.equal(blankOfficeFileName('word', '...hidden'), 'hidden.docx');
});

test('an empty name falls back to a sensible one', () => {
  assert.equal(blankOfficeFileName('word', ''), 'New document.docx');
  assert.equal(blankOfficeFileName('word', '   '), 'New document.docx');
  assert.equal(blankOfficeFileName('excel', '.xlsx'), 'New spreadsheet.xlsx');
});

test('each kind knows its editor and type', () => {
  assert.equal(blankOfficeSpec('word').appName, 'Word');
  assert.equal(blankOfficeSpec('excel').appName, 'Excel');
  assert.match(blankOfficeSpec('word').mimeType, /wordprocessingml\.document$/);
  assert.match(blankOfficeSpec('excel').mimeType, /spreadsheetml\.sheet$/);
});
