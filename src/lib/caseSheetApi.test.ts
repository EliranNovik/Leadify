import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildCaseSheetCellRows,
  caseSheetSharePath,
  formatCaseSheetEditedAt,
  caseSheetIdentity,
  hasCaseSheetIdentity,
  isForeignCellChange,
  viewerColor,
  viewerInitials,
  CASE_SHEET_NAME_MAX,
  nextCaseSheetName,
  normalizeCaseSheetName,
} from './caseSheetApi';

test('a current lead id becomes the uuid key', () => {
  const identity = caseSheetIdentity('23116209-5afc-4da3-954e-3a53ef8bc59d');
  assert.equal(identity.newLeadId, '23116209-5afc-4da3-954e-3a53ef8bc59d');
  assert.equal(identity.legacyLeadId, null);
  assert.equal(hasCaseSheetIdentity(identity), true);
});

test('a legacy lead id becomes the bigint key', () => {
  const identity = caseSheetIdentity('legacy_228842');
  assert.equal(identity.legacyLeadId, 228842);
  assert.equal(identity.newLeadId, null);
  assert.equal(hasCaseSheetIdentity(identity), true);
});

test('a missing client id yields no identity, so nothing is written against the wrong lead', () => {
  for (const value of [null, undefined, '']) {
    assert.equal(hasCaseSheetIdentity(caseSheetIdentity(value)), false);
  }
});

test('a save carries the cell address, value and who typed it', () => {
  const rows = buildCaseSheetCellRows(
    'sheet-1',
    [{ rowIndex: 2, colIndex: 3, value: 'Birth certificate', format: null }],
    'Tamar Ben-David',
  );

  assert.equal(rows.length, 1);
  assert.equal(rows[0].sheet_id, 'sheet-1');
  assert.equal(rows[0].row_index, 2);
  assert.equal(rows[0].col_index, 3);
  assert.equal(rows[0].value, 'Birth certificate');
  assert.equal(rows[0].updated_by, 'Tamar Ben-David');
});

test('a cleared cell is saved as an empty value rather than skipped', () => {
  /*
   * Skipping it would leave the old value in the database, so the cell would look blank until the
   * next reload and then come back.
   */
  const rows = buildCaseSheetCellRows(
    'sheet-1',
    [{ rowIndex: 0, colIndex: 0, value: '', format: null }],
    null,
  );
  assert.equal(rows.length, 1);
  assert.equal(rows[0].value, '');
});

test('presence initials are at most two letters', () => {
  assert.equal(viewerInitials('Tamar Ben-David'), 'TB');
  assert.equal(viewerInitials('Tamar'), 'TA');
  assert.equal(viewerInitials('Anna Maria Levi'), 'AL', 'first and last, not the middle name');
  assert.equal(viewerInitials('   '), '?');
  assert.equal(viewerInitials(null), '?');
});

test('a viewer keeps the same colour across reloads and looks the same to everyone', () => {
  // Otherwise "the blue cursor is Tamar" would stop being true on refresh.
  assert.equal(viewerColor('tamar@lawoffice.org.il'), viewerColor('tamar@lawoffice.org.il'));
  assert.match(viewerColor('tamar@lawoffice.org.il'), /^#[0-9a-f]{6}$/);
  assert.match(viewerColor(''), /^#[0-9a-f]{6}$/);
});

test('different viewers generally get different colours', () => {
  const keys = ['a@x.com', 'b@x.com', 'c@x.com', 'd@x.com', 'e@x.com'];
  const distinct = new Set(keys.map(viewerColor));
  assert.ok(distinct.size >= 3, `expected a spread of colours, got ${distinct.size}`);
});

test('a handler ignores the echo of their own save', () => {
  /*
   * Postgres publishes a change to every subscriber including its author. Applying your own echo
   * overwrites whatever you typed between saving and the echo arriving.
   */
  assert.equal(isForeignCellChange('Tamar Ben-David', 'Tamar Ben-David'), false);
  assert.equal(isForeignCellChange('Daniel Levi', 'Tamar Ben-David'), true);
});

test('a change with no author is applied rather than discarded', () => {
  // A row written by a script or an older build has no author; dropping it would lose real data.
  assert.equal(isForeignCellChange(null, 'Tamar Ben-David'), true);
});

test('with no identity of our own, every change is treated as foreign', () => {
  assert.equal(isForeignCellChange('Tamar Ben-David', null), true);
});

test('a save spells out the formatting columns, including the ones left off', () => {
  /*
   * The upsert replaces the row, so every column has to be present. An omitted `bold` would default
   * back to false and quietly un-bold the cell on the next text edit.
   */
  const rows = buildCaseSheetCellRows(
    'sheet-1',
    [
      {
        rowIndex: 0,
        colIndex: 0,
        value: 'Tamar',
        format: { bold: true, highlight: '#fef08a', fontSize: 20 },
      },
    ],
    'tamar@lawoffice.org.il',
  );

  assert.equal(rows[0].bold, true);
  assert.equal(rows[0].italic, false);
  assert.equal(rows[0].underline, false);
  assert.equal(rows[0].highlight, '#fef08a');
  assert.equal(rows[0].font_size, 20);
});

test('an unformatted cell saves as explicit defaults rather than missing columns', () => {
  const rows = buildCaseSheetCellRows(
    'sheet-1',
    [{ rowIndex: 0, colIndex: 0, value: 'plain', format: null }],
    null,
  );

  assert.equal(rows[0].bold, false);
  assert.equal(rows[0].italic, false);
  assert.equal(rows[0].underline, false);
  assert.equal(rows[0].highlight, null);
  assert.equal(rows[0].font_size, null);
});

/* ------------------------------------------------------------------ alignment and edited time */

test('an alignment is written to its own column', () => {
  const rows = buildCaseSheetCellRows(
    'sheet-1',
    [{ rowIndex: 0, colIndex: 0, value: 'Tamar', format: { align: 'center' } }],
    'eliran@lawoffice.org.il',
  );

  assert.equal(rows[0].align, 'center');
});

test('a cell with no alignment stores null rather than a default', () => {
  // An upsert replaces the row, so this is what hands a cell back to the sheet's direction.
  const rows = buildCaseSheetCellRows(
    'sheet-1',
    [{ rowIndex: 0, colIndex: 0, value: 'Tamar', format: { bold: true } }],
    null,
  );

  assert.equal(rows[0].align, null);
});

test('an edit from today shows only the time', () => {
  const now = new Date('2026-10-14T18:00:00Z');
  const label = formatCaseSheetEditedAt('2026-10-14T09:30:00Z', now);

  assert.ok(label.length > 0);
  assert.ok(!label.includes('at'), label);
});

test('an edit from yesterday says so', () => {
  const now = new Date('2026-10-14T12:00:00Z');
  assert.ok(formatCaseSheetEditedAt('2026-10-13T12:00:00Z', now).startsWith('yesterday at '));
});

test('an older edit carries its date', () => {
  const now = new Date('2026-10-14T12:00:00Z');
  const label = formatCaseSheetEditedAt('2026-10-02T12:00:00Z', now);

  assert.ok(label.includes('at '), label);
  assert.ok(!label.startsWith('yesterday'), label);
});

test('an edit from a previous year names the year', () => {
  const now = new Date('2026-10-14T12:00:00Z');
  assert.ok(formatCaseSheetEditedAt('2025-10-02T12:00:00Z', now).includes('2025'));
});

test('a missing or unreadable timestamp shows nothing at all', () => {
  // The byline hides itself on an empty string, rather than printing "Invalid Date".
  assert.equal(formatCaseSheetEditedAt(null), '');
  assert.equal(formatCaseSheetEditedAt(undefined), '');
  assert.equal(formatCaseSheetEditedAt(''), '');
  assert.equal(formatCaseSheetEditedAt('not a date'), '');
});

test('a month boundary is not mistaken for yesterday', () => {
  const now = new Date('2026-10-01T12:00:00Z');
  assert.ok(formatCaseSheetEditedAt('2026-09-30T12:00:00Z', now).startsWith('yesterday at '));
});

/* ------------------------------------------------------------------ lines and the share path */

test('the border edges are written to their own columns', () => {
  const rows = buildCaseSheetCellRows(
    'sheet-1',
    [
      {
        rowIndex: 0,
        colIndex: 0,
        value: '',
        format: { borderTop: true, borderLeft: true },
      },
    ],
    null,
  );

  assert.equal(rows[0].border_top, true);
  assert.equal(rows[0].border_left, true);
  assert.equal(rows[0].border_right, false);
  assert.equal(rows[0].border_bottom, false);
});

test('a share path keeps the sheet and the file apart', () => {
  const path = caseSheetSharePath('abc-123', 'Case_Handling_L1234.xlsx');

  assert.ok(path.startsWith('case-sheets/abc-123/'), path);
  assert.ok(path.endsWith('-Case_Handling_L1234.xlsx'), path);
});

test('a share path cannot be talked into another folder', () => {
  // The filename reaches a storage path, where a slash would quietly move the object.
  const path = caseSheetSharePath('../../etc', '../../../secret.xlsx');

  assert.equal(path.split('/').length, 3, path);
  assert.ok(!path.includes('..'), path);
});

test('a share path survives a name with nothing usable in it', () => {
  const path = caseSheetSharePath('', '///');

  assert.ok(path.startsWith('case-sheets/sheet/'), path);
  assert.ok(path.endsWith('-case-sheet.xlsx'), path);
});

test('a Hebrew filename keeps its extension', () => {
  // Storage keys are safest as ASCII, but losing the .xlsx leaves the recipient a file Excel will
  // not open — so the name gives way and the extension does not.
  const path = caseSheetSharePath('abc', 'תעודות.xlsx');

  assert.ok(path.startsWith('case-sheets/abc/'), path);
  assert.ok(path.endsWith('-case-sheet.xlsx'), path);
  assert.ok(!/[^\x00-\x7f]/.test(path), path);
});

test('a file with no extension at all is still named as a workbook', () => {
  assert.ok(caseSheetSharePath('abc', 'sheet').endsWith('-sheet.xlsx'));
});

// ---------------------------------------------------------------- tab names

test('a tab name is trimmed to one line', () => {
  assert.equal(normalizeCaseSheetName('  Applicants  '), 'Applicants');
  // A name pasted out of a document can arrive with newlines in it; a tab is one line.
  assert.equal(normalizeCaseSheetName('Birth\n certificates'), 'Birth certificates');
  assert.equal(normalizeCaseSheetName('a\tb'), 'a b');
});

test('a tab with no name falls back rather than becoming blank', () => {
  assert.equal(normalizeCaseSheetName(''), 'Sheet 1');
  assert.equal(normalizeCaseSheetName('   '), 'Sheet 1');
  assert.equal(normalizeCaseSheetName(null), 'Sheet 1');
  // Renaming to nothing keeps the name it had, which is what the caller passes as the fallback.
  assert.equal(normalizeCaseSheetName('', 'Documents'), 'Documents');
});

test('a tab name is capped, so one tab cannot push the rest off the strip', () => {
  const long = 'x'.repeat(500);
  assert.equal(normalizeCaseSheetName(long).length, CASE_SHEET_NAME_MAX);
});

test('a new tab takes the first unused name', () => {
  assert.equal(nextCaseSheetName([]), 'Sheet 1');
  assert.equal(nextCaseSheetName(['Sheet 1']), 'Sheet 2');
  assert.equal(nextCaseSheetName(['Sheet 1', 'Sheet 2']), 'Sheet 3');
  // Named tabs do not stand in the way of the numbering.
  assert.equal(nextCaseSheetName(['Applicants', 'Documents']), 'Sheet 1');
});

test('a deleted tab\'s name is reused, but never while it is still taken', () => {
  /*
   * Counting the tabs would give "Sheet 2" here, which already exists — and two tabs with the same
   * name are the one case a handler cannot tell apart.
   */
  assert.equal(nextCaseSheetName(['Sheet 1', 'Sheet 3']), 'Sheet 2');
  assert.equal(nextCaseSheetName(['Sheet 2', 'Sheet 3']), 'Sheet 1');
});

test('a name already taken in another case of letters still counts as taken', () => {
  assert.equal(nextCaseSheetName(['sheet 1', 'SHEET 2']), 'Sheet 3');
});
