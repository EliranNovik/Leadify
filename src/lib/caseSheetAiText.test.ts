import test from 'node:test';
import assert from 'node:assert/strict';

import {
  CASE_SHEET_AI_LEGEND,
  CASE_SHEET_AI_MARKER,
  CASE_SHEET_AI_MAX_CELL_CHARS,
  CASE_SHEET_AI_MAX_CHARS,
  CASE_SHEET_AI_MAX_COLUMNS,
  CASE_SHEET_AI_MAX_ROWS,
  renderCaseSheetsForAi,
  type CaseSheetAiCell,
} from './caseSheetAiText';

/** Cells in reading order, the way a row of a sheet is actually filled in. */
function row(rowIndex: number, values: string[]): CaseSheetAiCell[] {
  return values.map((value, colIndex) => ({ rowIndex, colIndex, value }));
}

// ---------------------------------------------------------------- the reading notes

test('the block opens by saying what these sheets are and how to read them', () => {
  const text = renderCaseSheetsForAi([{ name: 'Documents', cells: row(0, ['Passport']) }]);

  assert.ok(text.startsWith(CASE_SHEET_AI_MARKER), 'the marker must be the first thing in the block');
  assert.ok(text.includes(CASE_SHEET_AI_LEGEND));
});

test('the notes explain the conventions a handler actually uses', () => {
  /*
   * The two that a model gets wrong on its own: a tab is documents per person, and a bare V is the
   * whole status. Asserted on the legend itself so the wording cannot quietly lose them.
   */
  assert.match(CASE_SHEET_AI_LEGEND, /one row per document per contact/);
  assert.match(CASE_SHEET_AI_LEGEND, /"V" in a cell means YES/);
  assert.match(CASE_SHEET_AI_LEGEND, /✓/);
  assert.match(CASE_SHEET_AI_LEGEND, /וי/);
  assert.match(CASE_SHEET_AI_LEGEND, /empty cell means it has NOT been done/);
  assert.match(CASE_SHEET_AI_LEGEND, /day\/month\/year/);
  assert.match(CASE_SHEET_AI_LEGEND, /never invent a row, a date or a status/);
});

test('a case with no sheets carries no reading notes either', () => {
  // Nothing to explain, and a legend on its own would imply a sheet exists.
  assert.equal(renderCaseSheetsForAi([]).includes(CASE_SHEET_AI_MARKER), false);
});

test('a V stays exactly as the handler typed it', () => {
  const text = renderCaseSheetsForAi([
    {
      name: 'תעודות',
      rtl: true,
      cells: [...row(0, ['תעודת לידה', 'V']), ...row(1, ['תעודת נישואין', '✓']), ...row(2, ['דרכון', ''])],
    },
  ]);

  assert.match(text, /row 1 \| תעודת לידה \| V/);
  assert.match(text, /row 2 \| תעודת נישואין \| ✓/);
  // The third document has no tick, and must not acquire one.
  assert.match(text, /row 3 \| דרכון/);
  assert.equal(/row 3 \| דרכון \| ./.test(text), false);
});

// ---------------------------------------------------------------- the shape of a tab

test('a tab is named and its rows numbered as the handler sees them', () => {
  const text = renderCaseSheetsForAi([
    {
      name: 'Documents',
      cells: [
        ...row(0, ['Applicant', 'Document', 'Status']),
        ...row(1, ['Tamar', 'Birth certificate', 'Received']),
      ],
    },
  ]);

  assert.match(text, /TAB "Documents"/);
  assert.match(text, /2 rows with content/);
  // One-based, so a reply that says "row 2" means the row the handler is looking at.
  assert.match(text, /row 1 \| Applicant \| Document \| Status/);
  assert.match(text, /row 2 \| Tamar \| Birth certificate \| Received/);
});

test('empty rows are left out, and the numbering still points at the real row', () => {
  /*
   * A sheet is mostly blank space waiting to be filled. Rendering the gaps would spend the whole
   * budget on nothing, but renumbering what is left would make every reference wrong.
   */
  const text = renderCaseSheetsForAi([
    {
      name: 'Orders',
      cells: [...row(0, ['first']), ...row(9, ['tenth'])],
    },
  ]);

  assert.match(text, /row 1 \| first/);
  assert.match(text, /row 10 \| tenth/);
  assert.equal(text.includes('row 5'), false);
  assert.match(text, /2 rows with content/);
});

test('a column that only holds blanks does not widen the table', () => {
  const text = renderCaseSheetsForAi([
    { name: 'Sparse', cells: [...row(0, ['a', '', '   ']), ...row(1, ['b', '', ''])] },
  ]);

  assert.match(text, /row 1 \| a/);
  assert.equal(text.includes('| |'), false);
});

test('a sheet with nothing in it says so, rather than being left out', () => {
  // A tab a handler made and has not filled in is itself worth knowing.
  const text = renderCaseSheetsForAi([{ name: 'Later', cells: [] }]);

  assert.match(text, /TAB "Later" — empty/);
  assert.match(text, /nothing filled in yet/);
});

test('a case with no sheets renders as nothing at all', () => {
  assert.equal(renderCaseSheetsForAi([]), '');
  assert.equal(renderCaseSheetsForAi(null as never), '');
});

// ---------------------------------------------------------------- column names

test('columns the handler named are listed', () => {
  const text = renderCaseSheetsForAi([
    {
      name: 'Documents',
      columns: ['Applicant', 'Document', 'Status'],
      cells: row(0, ['Tamar', 'Passport', 'Ordered']),
    },
  ]);

  assert.match(text, /columns \| Applicant \| Document \| Status/);
});

test('columns still called A, B, C are not listed as if they meant something', () => {
  const text = renderCaseSheetsForAi([
    { name: 'Documents', columns: ['A', 'B', 'C'], cells: row(0, ['Tamar', 'Passport', 'Ordered']) },
  ]);

  assert.equal(text.includes('columns |'), false);
});

// ---------------------------------------------------------------- Hebrew

test('Hebrew is kept as written, and the direction is stated', () => {
  const text = renderCaseSheetsForAi([
    {
      name: 'תעודות',
      rtl: true,
      cells: [...row(0, ['תעודת נישואין', 'הוזמן']), ...row(1, ['תעודת לידה', 'התקבל'])],
    },
  ]);

  assert.match(text, /TAB "תעודות"/);
  assert.match(text, /right-to-left \(Hebrew\)/);
  assert.match(text, /row 1 \| תעודת נישואין \| הוזמן/);
});

test('a left-to-right sheet is not labelled Hebrew', () => {
  const text = renderCaseSheetsForAi([{ name: 'Docs', cells: row(0, ['x']) }]);
  assert.equal(text.includes('right-to-left'), false);
});

// ---------------------------------------------------------------- values that would break the format

test('a value cannot forge a column separator or a new row', () => {
  const text = renderCaseSheetsForAi([
    {
      name: 'Notes',
      cells: row(0, ['ordered | received | paid', 'line one\nline two']),
    },
  ]);

  const lines = text.split('\n').filter((line) => line.startsWith('row '));
  assert.equal(lines.length, 1, 'a newline inside a cell must not invent a second record');
  assert.match(text, /ordered \/ received \/ paid/);
  assert.match(text, /line one line two/);
});

test('a very long cell is clipped', () => {
  const text = renderCaseSheetsForAi([
    { name: 'Notes', cells: row(0, ['x'.repeat(1000)]) },
  ]);

  assert.equal(text.includes('x'.repeat(CASE_SHEET_AI_MAX_CELL_CHARS + 1)), false);
  assert.match(text, new RegExp(`x{${CASE_SHEET_AI_MAX_CELL_CHARS}}`));
});

test('a date is left exactly as the handler typed it', () => {
  // Dates in these sheets are text, and reformatting them would be inventing precision.
  const text = renderCaseSheetsForAi([
    { name: 'Dates', cells: row(0, ['02/09/2026', '2026-09-14']) },
  ]);

  assert.match(text, /row 1 \| 02\/09\/2026 \| 2026-09-14/);
});

// ---------------------------------------------------------------- budgets

test('a long sheet is cut at a row, and says how many are missing', () => {
  const cells: CaseSheetAiCell[] = [];
  for (let i = 0; i < CASE_SHEET_AI_MAX_ROWS + 15; i += 1) {
    cells.push(...row(i, [`record ${i}`]));
  }

  const text = renderCaseSheetsForAi([{ name: 'Long', cells }]);

  assert.match(text, new RegExp(`${CASE_SHEET_AI_MAX_ROWS + 15} rows with content`));
  assert.match(text, /… 15 further rows not shown/);
  assert.match(text, new RegExp(`row ${CASE_SHEET_AI_MAX_ROWS} \\| record ${CASE_SHEET_AI_MAX_ROWS - 1}`));
  assert.equal(text.includes(`row ${CASE_SHEET_AI_MAX_ROWS + 1} |`), false);
});

test('columns past the limit are dropped rather than stretching every row', () => {
  const text = renderCaseSheetsForAi([
    {
      name: 'Wide',
      cells: row(
        0,
        Array.from({ length: CASE_SHEET_AI_MAX_COLUMNS + 5 }, (_, i) => `c${i}`),
      ),
    },
  ]);

  assert.match(text, new RegExp(`c${CASE_SHEET_AI_MAX_COLUMNS - 1}`));
  assert.equal(text.includes(`c${CASE_SHEET_AI_MAX_COLUMNS}`), false);
});

test('tabs that do not fit are dropped whole, never halfway', () => {
  /*
   * A tab cut off in the middle reads like a tab that ends there, and a model would report the
   * missing rows as absent rather than unseen.
   */
  const bulk = (name: string): { name: string; cells: CaseSheetAiCell[] } => ({
    name,
    cells: Array.from({ length: CASE_SHEET_AI_MAX_ROWS }, (_, i) =>
      row(i, ['y'.repeat(CASE_SHEET_AI_MAX_CELL_CHARS)]),
    ).flat(),
  });

  const text = renderCaseSheetsForAi([bulk('First'), bulk('Second'), bulk('Third')]);

  assert.match(text, /TAB "First"/);
  assert.match(text, /further tabs not shown/);
  // Whatever was dropped, nothing is left mid-row.
  for (const line of text.split('\n')) {
    if (line.startsWith('row ')) assert.match(line, /\| y+$/);
  }
});

test('the first tab is always included, however large it is', () => {
  // Dropping everything would be worse than going over budget on one tab.
  const huge = {
    name: 'Everything',
    cells: Array.from({ length: CASE_SHEET_AI_MAX_ROWS }, (_, i) =>
      row(i, Array.from({ length: 10 }, () => 'z'.repeat(CASE_SHEET_AI_MAX_CELL_CHARS))),
    ).flat(),
  };

  const text = renderCaseSheetsForAi([huge]);
  assert.match(text, /TAB "Everything"/);
  assert.ok(text.length > CASE_SHEET_AI_MAX_CHARS);
});

test('several small tabs all fit', () => {
  const text = renderCaseSheetsForAi([
    { name: 'Applicants', cells: row(0, ['Tamar']) },
    { name: 'Documents', cells: row(0, ['Passport']) },
    { name: 'תעודות', rtl: true, cells: row(0, ['תעודת לידה']) },
  ]);

  assert.match(text, /TAB "Applicants"/);
  assert.match(text, /TAB "Documents"/);
  assert.match(text, /TAB "תעודות"/);
  assert.equal(text.includes('further tabs not shown'), false);
});

// ---------------------------------------------------------------- the heading

test('when the tab was last changed is shown as a date alone', () => {
  const text = renderCaseSheetsForAi([
    { name: 'Documents', updatedAt: '2026-10-14T13:21:55.123Z', cells: row(0, ['x']) },
  ]);

  assert.match(text, /last changed 2026-10-14/);
  assert.equal(text.includes('13:21'), false);
});

test('a cell with a broken row or column reference is skipped, not guessed at', () => {
  const text = renderCaseSheetsForAi([
    {
      name: 'Odd',
      cells: [
        { rowIndex: 0, colIndex: 0, value: 'kept' },
        { rowIndex: Number.NaN, colIndex: 0, value: 'dropped' },
        { rowIndex: 1, colIndex: Number.NaN, value: 'dropped too' },
      ],
    },
  ]);

  assert.match(text, /kept/);
  assert.equal(text.includes('dropped'), false);
  assert.match(text, /1 rows with content/);
});
