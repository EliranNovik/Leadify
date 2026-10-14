import test from 'node:test';
import assert from 'node:assert/strict';

import {
  CASE_SHEET_ALIGNMENTS,
  hasNamedColumns,
  applyBorderPreset,
  CASE_SHEET_COLUMN_WIDTH_DEFAULT,
  CASE_SHEET_COLUMN_WIDTH_MAX,
  CASE_SHEET_COLUMN_WIDTH_MIN,
  CASE_SHEET_ROW_HEIGHT_DEFAULT,
  CASE_SHEET_ROW_HEIGHT_MAX,
  CASE_SHEET_ROW_HEIGHT_MIN,
  applyRemoteShape,
  resolveColumnWidth,
  resolveRowHeight,
  setColumnWidth,
  setRowHeight,
  sizeMapToRecord,
  appendRows,
  normalizeAlign,
  bandRange,
  isColumnFullySelected,
  isRowFullySelected,
  rangeCells,
  CASE_SHEET_FONT_SIZE_DEFAULT,
  bandMapToRecord,
  containsRtlText,
  detectRtl,
  CASE_SHEET_HIGHLIGHTS,
  CASE_SHEET_MAX_CELL_LENGTH,
  appendColumn,
  applyFormat,
  applyPastedBlock,
  applyRemoteCell,
  cellChange,
  cellKey,
  columnLabel,
  createEmptyGrid,
  deleteRow,
  formatFromStoredCell,
  getCell,
  getFormat,
  gridFromAoa,
  gridFromStoredCells,
  gridToAoa,
  isFormatActive,
  normalizeCellValue,
  normalizeFontSize,
  normalizeFormat,
  normalizeHighlight,
  parseCellKey,
  parsePastedBlock,
  renameColumn,
  resolveCellBackground,
  setCell,
  setColumnColor,
  setRowColor,
  sharedFormatValue,
  usedBounds,
  fontSizeFromPoints,
  formatFromImportedStyle,
} from './caseSheetGrid';

test('column labels follow spreadsheet lettering past Z', () => {
  assert.equal(columnLabel(0), 'A');
  assert.equal(columnLabel(25), 'Z');
  assert.equal(columnLabel(26), 'AA');
  assert.equal(columnLabel(27), 'AB');
  assert.equal(columnLabel(51), 'AZ');
  assert.equal(columnLabel(52), 'BA');
});

test('cell keys round-trip, and nonsense is rejected rather than guessed at', () => {
  assert.equal(cellKey(3, 7), '3:7');
  assert.deepEqual(parseCellKey('3:7'), { rowIndex: 3, colIndex: 7 });
  assert.equal(parseCellKey('x:7'), null);
  assert.equal(parseCellKey('-1:7'), null);
  assert.equal(parseCellKey(''), null);
});

test('a cell keeps what was typed rather than being coerced to a number', () => {
  // The whole reason values are stored as text: these must survive a round trip intact.
  assert.equal(normalizeCellValue('007'), '007');
  assert.equal(normalizeCellValue('L230773/2'), 'L230773/2');
  assert.equal(normalizeCellValue('+972 50 123 4567'), '+972 50 123 4567');
});

test('a cell is one line, so pasted newlines become spaces instead of breaking the row', () => {
  assert.equal(normalizeCellValue('first\nsecond'), 'first second');
  assert.equal(normalizeCellValue('  padded  '), 'padded');
});

test('an over-long value is capped rather than rejected by the database', () => {
  const value = normalizeCellValue('x'.repeat(CASE_SHEET_MAX_CELL_LENGTH + 500));
  assert.equal(value.length, CASE_SHEET_MAX_CELL_LENGTH);
});

test('a blank cell is removed, not stored as an empty string', () => {
  // Saves only carry changed cells, so blanks must not accumulate as keys.
  let grid = createEmptyGrid();
  grid = setCell(grid, 2, 1, 'something').grid;
  assert.equal(grid.cells.size, 1);

  grid = setCell(grid, 2, 1, '   ').grid;
  assert.equal(grid.cells.size, 0);
  assert.equal(getCell(grid, 2, 1), '');
});

test('retyping the same value reports no change, so nothing is saved or broadcast', () => {
  // Otherwise a no-op edit would bump updated_by and look like a colleague overwrote the cell.
  const grid = setCell(createEmptyGrid(), 0, 0, 'Tamar').grid;
  const again = setCell(grid, 0, 0, 'Tamar');
  assert.equal(again.changed, false);
  assert.equal(again.grid, grid, 'an unchanged grid should be returned by reference');
});

test('typing below the last row grows the sheet', () => {
  const grid = createEmptyGrid();
  const grown = setCell(grid, grid.rowCount + 3, 0, 'later').grid;
  assert.equal(grown.rowCount, grid.rowCount + 4);
});

test('editing does not mutate the previous grid', () => {
  // The component holds the grid in state and compares by reference to decide on a re-render.
  const before = setCell(createEmptyGrid(), 1, 1, 'first').grid;
  const snapshot = new Map(before.cells);
  setCell(before, 1, 1, 'second');
  assert.deepEqual([...before.cells], [...snapshot]);
});

test('an emptied column header falls back to its letter', () => {
  const grid = renameColumn(createEmptyGrid(), 2, '   ');
  assert.equal(grid.columns[2], 'C');
});

test('a clipboard block splits on tabs and newlines the way Excel writes it', () => {
  assert.deepEqual(parsePastedBlock('a\tb\nc\td'), [
    ['a', 'b'],
    ['c', 'd'],
  ]);
  // Excel appends a trailing newline to a copied selection.
  assert.deepEqual(parsePastedBlock('a\tb\r\n'), [['a', 'b']]);
  assert.deepEqual(parsePastedBlock(''), []);
});

test('a paste lands at the anchor and reports every cell it changed', () => {
  const { grid, changes } = applyPastedBlock(createEmptyGrid(), 2, 1, [
    ['Name', 'Status'],
    ['Tamar', 'Open'],
  ]);

  assert.equal(getCell(grid, 2, 1), 'Name');
  assert.equal(getCell(grid, 2, 2), 'Status');
  assert.equal(getCell(grid, 3, 1), 'Tamar');
  assert.equal(getCell(grid, 3, 2), 'Open');
  assert.equal(changes.length, 4, 'all four cells need saving and broadcasting');
});

test('a paste wider than the sheet grows the columns instead of dropping them', () => {
  const narrow = { columns: ['A', 'B'], rowCount: 5, cells: new Map<string, string>(), formats: new Map(), rtl: false, rowColors: new Map(), columnColors: new Map() };
  const { grid } = applyPastedBlock(narrow, 0, 1, [['x', 'y', 'z']]);
  assert.equal(grid.columns.length, 4, 'anchored at column 1, three wide, so four columns');
  assert.equal(getCell(grid, 0, 3), 'z');
});

test('deleting a row shifts the rows below it up', () => {
  let grid = createEmptyGrid();
  grid = setCell(grid, 0, 0, 'first').grid;
  grid = setCell(grid, 1, 0, 'second').grid;
  grid = setCell(grid, 2, 0, 'third').grid;

  const { grid: next } = deleteRow(grid, 1);
  assert.equal(getCell(next, 0, 0), 'first');
  assert.equal(getCell(next, 1, 0), 'third');
  assert.equal(getCell(next, 2, 0), '', 'the vacated bottom row must be empty');
});

test('deleting a row returns changes that clear the row the last value vacated', () => {
  /*
   * Without this the old bottom value stays in the database and reappears on reload, even though the
   * on-screen grid looks right.
   */
  let grid = createEmptyGrid();
  grid = setCell(grid, 0, 0, 'first').grid;
  grid = setCell(grid, 1, 0, 'second').grid;

  const { changes } = deleteRow(grid, 0);
  const vacated = changes.find((c) => c.rowIndex === 1 && c.colIndex === 0);
  assert.ok(vacated, 'row 1 should be in the changes');
  assert.equal(vacated?.value, '');

  const moved = changes.find((c) => c.rowIndex === 0 && c.colIndex === 0);
  assert.equal(moved?.value, 'second');
});

test('an uploaded sheet takes its headers from the first row', () => {
  const grid = gridFromAoa([
    ['Applicant', 'Document', 'Received'],
    ['Tamar Ben-David', 'Birth certificate', 'Yes'],
    ['Daniel Levi', 'Passport', 'No'],
  ]);

  assert.deepEqual(grid.columns, ['Applicant', 'Document', 'Received']);
  assert.equal(getCell(grid, 0, 0), 'Tamar Ben-David');
  assert.equal(getCell(grid, 1, 2), 'No');
});

test('an uploaded sheet with a gap in its header row still addresses every column', () => {
  const grid = gridFromAoa([
    ['Applicant', '', 'Received'],
    ['Tamar', 'Birth certificate', 'Yes'],
  ]);
  assert.deepEqual(grid.columns, ['Applicant', 'B', 'Received']);
  assert.equal(getCell(grid, 0, 1), 'Birth certificate');
});

test('an uploaded sheet leaves blank rows to type into', () => {
  const grid = gridFromAoa([['H'], ['one'], ['two']]);
  assert.ok(grid.rowCount > 2, `expected room past the data, got ${grid.rowCount}`);
});

test('a ragged sheet is squared off to its widest row', () => {
  const grid = gridFromAoa([['A', 'B', 'C'], ['only one'], ['a', 'b']]);
  assert.equal(grid.columns.length, 3);
  assert.equal(getCell(grid, 1, 1), 'b');
});

test('export trims unused trailing cells', () => {
  let grid = createEmptyGrid();
  grid = setCell(grid, 0, 0, 'Tamar').grid;
  grid = setCell(grid, 1, 1, 'Open').grid;

  const aoa = gridToAoa(grid);
  assert.equal(aoa[0][0], 'Tamar');
  assert.equal(aoa[1][1], 'Open');
  assert.equal(aoa.length, 2, 'two used rows, not the full 25');
});

test('export writes no header row while the columns are still called by letter', () => {
  // A row reading "A, B, C" is noise in a spreadsheet that already labels its columns that way.
  const grid = setCell(createEmptyGrid(), 0, 0, 'Tamar').grid;

  assert.equal(hasNamedColumns(grid), false);
  assert.equal(gridToAoa(grid)[0][0], 'Tamar');
});

test('export writes a header row once a column has been named', () => {
  let grid = renameColumn(createEmptyGrid(), 0, 'Applicant');
  grid = setCell(grid, 0, 0, 'Tamar').grid;

  assert.equal(hasNamedColumns(grid), true);
  const aoa = gridToAoa(grid);
  assert.equal(aoa[0][0], 'Applicant');
  assert.equal(aoa[1][0], 'Tamar');
});

test('naming one column of several is enough to earn a header row', () => {
  const grid = renameColumn(createEmptyGrid(), 2, 'Received');

  assert.equal(hasNamedColumns(grid), true);
  assert.equal(gridToAoa(grid)[0][2], 'Received');
});

test('a sheet survives the full round trip through Excel and back', () => {
  const original = gridFromAoa([
    ['Applicant', 'Reference'],
    ['Tamar', 'L230773/2'],
    ['Daniel', '007'],
  ]);

  const restored = gridFromAoa(gridToAoa(original));
  assert.deepEqual(restored.columns, original.columns);
  assert.equal(getCell(restored, 0, 1), 'L230773/2');
  assert.equal(getCell(restored, 1, 1), '007', 'a leading zero must not be lost');
});

test('stored cells rebuild the grid, ignoring rows the schema should never contain', () => {
  const grid = gridFromStoredCells(['Applicant', 'Status'], 30, [
    { row_index: 0, col_index: 0, value: 'Tamar' },
    { row_index: 1, col_index: 1, value: 'Open' },
    { row_index: 'x', col_index: 0, value: 'junk' },
    { row_index: 2, col_index: 0, value: '' },
  ]);

  assert.equal(grid.cells.size, 2);
  assert.equal(getCell(grid, 0, 0), 'Tamar');
  assert.equal(grid.rowCount, 30);
});

test('a stored sheet never hides cells that sit past its recorded size', () => {
  /*
   * row_count and columns are convenience copies; the cells are the truth. If a save of the parent
   * row were lost, a smaller recorded size must not make real data unreachable.
   */
  const grid = gridFromStoredCells(['Only'], 1, [
    { row_index: 40, col_index: 3, value: 'far out' },
  ]);

  assert.ok(grid.rowCount > 40, `row count ${grid.rowCount} would hide row 40`);
  assert.ok(grid.columns.length > 3, `${grid.columns.length} columns would hide column 3`);
  assert.equal(getCell(grid, 40, 3), 'far out');
});

test('a remote cell is applied without otherwise reshaping the sheet', () => {
  const grid = { columns: ['A', 'B'], rowCount: 10, cells: new Map<string, string>(), formats: new Map(), rtl: false, rowColors: new Map(), columnColors: new Map() };
  const next = applyRemoteCell(grid, 3, 1, 'from a colleague');
  assert.equal(getCell(next, 3, 1), 'from a colleague');
  assert.equal(next.rowCount, 10, 'an inbound edit inside the sheet must not grow it');
  assert.equal(next.columns.length, 2);
});

test('a remote clear removes the cell', () => {
  const grid = setCell(createEmptyGrid(), 1, 1, 'was here').grid;
  const next = applyRemoteCell(grid, 1, 1, '');
  assert.equal(getCell(next, 1, 1), '');
  assert.equal(next.cells.size, 0);
});

test('an unchanged remote cell returns the same grid, so no re-render is triggered', () => {
  const grid = setCell(createEmptyGrid(), 1, 1, 'same').grid;
  assert.equal(applyRemoteCell(grid, 1, 1, 'same'), grid);
});

test('used bounds never report fewer columns than the sheet has headers', () => {
  const grid = appendColumn(appendColumn(createEmptyGrid()));
  assert.equal(usedBounds(grid).cols, grid.columns.length);
});

// ---------------------------------------------------------------- formatting

test('switching a format off leaves no trace behind', () => {
  /*
   * A leftover `{ bold: false }` would make the cell read as formatted forever, including to the
   * toolbar's own "is this bold" check.
   */
  const bolded = applyFormat(createEmptyGrid(), [{ rowIndex: 0, colIndex: 0 }], { bold: true });
  assert.equal(bolded.grid.formats.size, 1);

  const plain = applyFormat(bolded.grid, [{ rowIndex: 0, colIndex: 0 }], { bold: null });
  assert.equal(plain.grid.formats.size, 0, 'the cell should have no format entry at all');
  assert.equal(getFormat(plain.grid, 0, 0), null);
});

test('the default text size is stored as no size at all', () => {
  const result = applyFormat(createEmptyGrid(), [{ rowIndex: 0, colIndex: 0 }], {
    fontSize: CASE_SHEET_FONT_SIZE_DEFAULT,
  });
  assert.equal(result.changes.length, 0, 'setting the default is not a change');
  assert.equal(getFormat(result.grid, 0, 0), null);
});

test('only a size from the palette is accepted', () => {
  assert.equal(normalizeFontSize(20), 20);
  assert.equal(normalizeFontSize(99), undefined);
  assert.equal(normalizeFontSize('nonsense'), undefined);
});

test('one formatting change does not disturb the others on the cell', () => {
  let grid = applyFormat(createEmptyGrid(), [{ rowIndex: 0, colIndex: 0 }], {
    bold: true,
    fontSize: 20,
  }).grid;
  grid = applyFormat(grid, [{ rowIndex: 0, colIndex: 0 }], { highlight: '#fef08a' }).grid;

  const format = getFormat(grid, 0, 0);
  assert.equal(format?.bold, true, 'bold must survive a highlight change');
  assert.equal(format?.fontSize, 20);
  assert.equal(format?.highlight, '#fef08a');
});

test('formatting applies across a whole selection', () => {
  const targets = [
    { rowIndex: 0, colIndex: 0 },
    { rowIndex: 0, colIndex: 1 },
    { rowIndex: 1, colIndex: 0 },
  ];
  const result = applyFormat(createEmptyGrid(), targets, { bold: true });
  assert.equal(result.changes.length, 3, 'every cell needs saving and broadcasting');
  assert.equal(isFormatActive(result.grid, targets, 'bold'), true);
});

test('a toggle reads as on only when every selected cell agrees', () => {
  const targets = [
    { rowIndex: 0, colIndex: 0 },
    { rowIndex: 0, colIndex: 1 },
  ];
  const grid = applyFormat(createEmptyGrid(), [targets[0]], { bold: true }).grid;
  assert.equal(isFormatActive(grid, [targets[0]], 'bold'), true);
  assert.equal(isFormatActive(grid, targets, 'bold'), false, 'a mixed selection is not bold');
  assert.equal(isFormatActive(grid, [], 'bold'), false);
});

test('a mixed selection reports no shared size or colour', () => {
  // Otherwise the dropdowns would claim a value the selection does not actually have.
  const targets = [
    { rowIndex: 0, colIndex: 0 },
    { rowIndex: 0, colIndex: 1 },
  ];
  const grid = applyFormat(createEmptyGrid(), [targets[0]], {
    fontSize: 20,
    highlight: '#fef08a',
  }).grid;

  assert.equal(sharedFormatValue(grid, [targets[0]], 'fontSize'), 20);
  assert.equal(sharedFormatValue(grid, targets, 'fontSize'), null);
  assert.equal(sharedFormatValue(grid, targets, 'highlight'), null);
});

test('reapplying the same format changes nothing, so nothing is saved', () => {
  const grid = applyFormat(createEmptyGrid(), [{ rowIndex: 0, colIndex: 0 }], { bold: true }).grid;
  const again = applyFormat(grid, [{ rowIndex: 0, colIndex: 0 }], { bold: true });
  assert.equal(again.changes.length, 0);
  assert.equal(again.grid, grid, 'an unchanged grid should be returned by reference');
});

test('clearing a cell keeps its formatting', () => {
  /*
   * A handler who highlights a cell and then deletes the wrong value should not have to re-apply the
   * highlight.
   */
  let grid = applyFormat(createEmptyGrid(), [{ rowIndex: 0, colIndex: 0 }], {
    highlight: '#fef08a',
  }).grid;
  grid = setCell(grid, 0, 0, 'typo').grid;
  grid = setCell(grid, 0, 0, '').grid;

  assert.equal(getCell(grid, 0, 0), '');
  assert.equal(getFormat(grid, 0, 0)?.highlight, '#fef08a');
});

test('a text edit carries the cell formatting with it', () => {
  // The save upserts the whole row, so a change that omitted the format would reset it to plain.
  const grid = applyFormat(createEmptyGrid(), [{ rowIndex: 0, colIndex: 0 }], { bold: true }).grid;
  const edited = setCell(grid, 0, 0, 'Tamar').grid;

  const change = cellChange(edited, 0, 0);
  assert.equal(change.value, 'Tamar');
  assert.equal(change.format?.bold, true);
});

test('a formatting change carries the cell text with it', () => {
  const grid = setCell(createEmptyGrid(), 0, 0, 'Tamar').grid;
  const result = applyFormat(grid, [{ rowIndex: 0, colIndex: 0 }], { underline: true });
  assert.equal(result.changes[0].value, 'Tamar', 'the text must not be reset to blank');
  assert.equal(result.changes[0].format?.underline, true);
});

test('a styled but empty cell counts as part of the sheet', () => {
  /*
   * Bounds drive the exported size and the stored row count. If a highlighted blank cell did not
   * count, reloading would hide it.
   */
  const grid = applyFormat(createEmptyGrid(), [{ rowIndex: 40, colIndex: 3 }], {
    highlight: '#fef08a',
  }).grid;

  const bounds = usedBounds(grid);
  assert.equal(bounds.rows, 41);
  assert.ok(bounds.cols >= 4);
});

test('deleting a row moves formatting up with the row below', () => {
  let grid = createEmptyGrid();
  grid = setCell(grid, 1, 0, 'second').grid;
  grid = applyFormat(grid, [{ rowIndex: 1, colIndex: 0 }], { bold: true }).grid;

  const { grid: next } = deleteRow(grid, 0);
  assert.equal(getCell(next, 0, 0), 'second');
  assert.equal(getFormat(next, 0, 0)?.bold, true, 'the style belongs to the row, not the position');
  assert.equal(getFormat(next, 1, 0), null, 'the vacated row must be unformatted');
});

test('deleting a row reports the vacated cell as blank and unformatted', () => {
  let grid = createEmptyGrid();
  grid = setCell(grid, 1, 0, 'second').grid;
  grid = applyFormat(grid, [{ rowIndex: 1, colIndex: 0 }], { bold: true }).grid;

  const { changes } = deleteRow(grid, 0);
  const vacated = changes.find((c) => c.rowIndex === 1 && c.colIndex === 0);
  assert.equal(vacated?.value, '');
  assert.equal(vacated?.format, null);

  const moved = changes.find((c) => c.rowIndex === 0 && c.colIndex === 0);
  assert.equal(moved?.value, 'second');
  assert.equal(moved?.format?.bold, true);
});

test('deleting a row clears the formatting of a styled but empty cell', () => {
  const grid = applyFormat(createEmptyGrid(), [{ rowIndex: 0, colIndex: 0 }], {
    highlight: '#fef08a',
  }).grid;

  const { grid: next, changes } = deleteRow(grid, 0);
  assert.equal(getFormat(next, 0, 0), null);
  assert.equal(changes.length, 1, 'the cleared cell still has to be saved');
  assert.equal(changes[0].format, null);
});

test('a paste keeps the destination formatting, since the clipboard is plain text', () => {
  const grid = applyFormat(createEmptyGrid(), [{ rowIndex: 0, colIndex: 0 }], { bold: true }).grid;
  const result = applyPastedBlock(grid, 0, 0, [['pasted', 'next']]);

  assert.equal(getCell(result.grid, 0, 0), 'pasted');
  assert.equal(getFormat(result.grid, 0, 0)?.bold, true);
  assert.equal(result.changes[0].format?.bold, true, 'the save must carry the kept format');
  assert.equal(result.changes[1].format, null, 'an unformatted destination stays unformatted');
});

test('stored formatting columns rebuild the cell style', () => {
  const grid = gridFromStoredCells(['A'], 5, [
    {
      row_index: 0,
      col_index: 0,
      value: 'Tamar',
      bold: true,
      italic: false,
      underline: true,
      highlight: '#bbf7d0',
      font_size: 20,
    },
  ]);

  const format = getFormat(grid, 0, 0);
  assert.equal(format?.bold, true);
  assert.equal(format?.italic, undefined, 'a false flag is absent, not false');
  assert.equal(format?.underline, true);
  assert.equal(format?.highlight, '#bbf7d0');
  assert.equal(format?.fontSize, 20);
});

test('a stored cell that is styled but empty is not discarded', () => {
  const grid = gridFromStoredCells(['A'], 5, [
    { row_index: 2, col_index: 1, value: '', highlight: '#fef08a' },
  ]);

  assert.equal(grid.cells.size, 0, 'there is no text to hold');
  assert.equal(getFormat(grid, 2, 1)?.highlight, '#fef08a');
});

test('a stored colour outside the palette is dropped', () => {
  const grid = gridFromStoredCells(['A'], 5, [
    { row_index: 0, col_index: 0, value: 'x', highlight: 'javascript:alert(1)' },
  ]);
  assert.equal(getFormat(grid, 0, 0), null);
});

test('a remote change applies formatting as well as text', () => {
  const grid = applyRemoteCell(createEmptyGrid(), 1, 1, 'from a colleague', { bold: true });
  assert.equal(getCell(grid, 1, 1), 'from a colleague');
  assert.equal(getFormat(grid, 1, 1)?.bold, true);
});

test('a remote change that only clears formatting still applies', () => {
  // Treating this as "nothing changed" would leave a colleague's un-bolding invisible to everyone.
  const grid = applyFormat(createEmptyGrid(), [{ rowIndex: 0, colIndex: 0 }], { bold: true }).grid;
  const next = applyRemoteCell(grid, 0, 0, '', null);
  assert.notEqual(next, grid);
  assert.equal(getFormat(next, 0, 0), null);
});

test('an unchanged remote cell still returns the same grid', () => {
  const grid = applyFormat(setCell(createEmptyGrid(), 0, 0, 'same').grid, [
    { rowIndex: 0, colIndex: 0 },
  ], { bold: true }).grid;

  assert.equal(applyRemoteCell(grid, 0, 0, 'same', { bold: true }), grid);
});

test('export carries the text, and the formatting travels separately', () => {
  /*
   * The array of arrays is only the text. Formatting goes onto the written cells by the exporter,
   * which is why a styled cell leaves no trace here.
   */
  const grid = applyFormat(setCell(createEmptyGrid(), 0, 0, 'Tamar').grid, [
    { rowIndex: 0, colIndex: 0 },
  ], { bold: true, highlight: '#fef08a' }).grid;

  const aoa = gridToAoa(grid);
  assert.equal(aoa[0][0], 'Tamar');
});

test('an uploaded file keeps its own first row as a row', () => {
  /*
   * Its titles are data, not column names: promoting them would put them where A, B, C live and
   * leave the sheet one row short of the file that was uploaded.
   */
  const grid = gridFromAoa(
    [
      ['contact', 'email', 'phone'],
      ['eliran', 'e@example.com', '050'],
    ],
    { hasHeaderRow: false },
  );

  assert.deepEqual(grid.columns, ['A', 'B', 'C']);
  assert.equal(getCell(grid, 0, 0), 'contact');
  assert.equal(getCell(grid, 1, 0), 'eliran');
});

test('an uploaded file imported as data round trips without gaining a row', () => {
  const rows = [
    ['contact', 'email'],
    ['eliran', 'e@example.com'],
  ];
  const grid = gridFromAoa(rows, { hasHeaderRow: false });

  assert.deepEqual(gridToAoa(grid), rows);
});

test('colours and heights line up with the rows when there is no header row', () => {
  const grid = gridFromAoa(
    [
      ['contact', 'email'],
      ['eliran', ''],
    ],
    {
      hasHeaderRow: false,
      styles: [[{ fill: '#fef08a' }, null], [null, { fill: '#bbf7d0' }]],
      rowHeights: [64, null],
    },
  );

  assert.equal(getFormat(grid, 0, 0)?.highlight, '#fef08a');
  assert.equal(getFormat(grid, 1, 1)?.highlight, '#bbf7d0');
  assert.equal(resolveRowHeight(grid, 0), 64);
  // Without a header row to take them, the first row's colours stay on the cells.
  assert.deepEqual(bandMapToRecord(grid.columnColors), {});
});

// ---------------------------------------------------------------- direction

test('Hebrew and Arabic are recognised as right-to-left', () => {
  assert.equal(containsRtlText('שם הלקוח'), true);
  assert.equal(containsRtlText('تاريخ'), true);
  assert.equal(containsRtlText('Applicant'), false);
  assert.equal(containsRtlText('2026-09-02'), false);
  assert.equal(containsRtlText(''), false);
});

test('a mostly Hebrew sheet reads right to left', () => {
  assert.equal(
    detectRtl([
      ['שם', 'מסמך'],
      ['תמר', 'תעודת לידה'],
    ]),
    true,
  );
});

test('an English sheet with one Hebrew name in it is left alone', () => {
  /*
   * A sheet is mirrored only when right-to-left text is the majority. Flipping a mostly English
   * sheet because one applicant has a Hebrew name would rearrange its author's own layout.
   */
  assert.equal(
    detectRtl([
      ['Applicant', 'Document', 'Status'],
      ['תמר', 'Birth certificate', 'Received'],
      ['Daniel Levi', 'Passport', 'Awaiting'],
    ]),
    false,
  );
});

test('cells with no letters do not vote on direction', () => {
  // A sheet of dates and reference numbers has no reading direction to infer.
  assert.equal(detectRtl([['2026-09-02', '12345', '']]), false);
  assert.equal(detectRtl([['2026-09-02', 'שם']]), true);
});

test('an empty sheet is left to right', () => {
  assert.equal(detectRtl([]), false);
  assert.equal(detectRtl([[], ['']]), false);
});

test('a declared right-to-left workbook overrides what its text looks like', () => {
  /*
   * Excel records this on the workbook view. A sheet of Hebrew column headings over English data
   * should still read the way its author set it up.
   */
  const grid = gridFromAoa([['Applicant', 'Document'], ['Daniel', 'Passport']], { rtl: true });
  assert.equal(grid.rtl, true);
});

test('an undeclared sheet falls back to detection', () => {
  const hebrew = gridFromAoa([['שם'], ['תמר']], { rtl: undefined });
  assert.equal(hebrew.rtl, true);

  const english = gridFromAoa([['Applicant'], ['Daniel']], { rtl: undefined });
  assert.equal(english.rtl, false);
});

// ---------------------------------------------------------------- colours

test('any six-digit hex colour is accepted, with or without the hash', () => {
  // An uploaded workbook brings its own colours, which will not be from our palette.
  assert.equal(normalizeHighlight('#92D050'), '#92d050');
  assert.equal(normalizeHighlight('92D050'), '#92d050');
  assert.equal(normalizeHighlight(CASE_SHEET_HIGHLIGHTS[0].value), CASE_SHEET_HIGHLIGHTS[0].value);
});

test('anything that is not a colour is dropped', () => {
  // The value is written into a style attribute, so only an exact hex shape gets through.
  for (const bad of [
    'red',
    'red; background:url(javascript:alert(1))',
    '#12345',
    '#1234567',
    'rgb(1,2,3)',
    'javascript:alert(1)',
    '',
    null,
    undefined,
  ]) {
    assert.equal(normalizeHighlight(bad), undefined, `${String(bad)} should not be a colour`);
  }
});

test('a row colour applies to the row and clears again', () => {
  let grid = setRowColor(createEmptyGrid(), 2, '#fef08a');
  assert.equal(grid.rowColors.get(2), '#fef08a');

  grid = setRowColor(grid, 2, null);
  assert.equal(grid.rowColors.has(2), false);
});

test('an invalid row colour is refused rather than stored', () => {
  const grid = setRowColor(createEmptyGrid(), 0, 'definitely not a colour');
  assert.equal(grid.rowColors.size, 0);
});

test('setting the colour a row already has returns the same grid', () => {
  const grid = setRowColor(createEmptyGrid(), 1, '#fef08a');
  assert.equal(setRowColor(grid, 1, '#fef08a'), grid);
});

test('a cell highlight outranks its row, which outranks its column', () => {
  /*
   * Narrowest wins. If a row colour covered a cell highlight, deliberately marking one cell would
   * become invisible the moment someone painted the row.
   */
  let grid = createEmptyGrid();
  grid = setColumnColor(grid, 0, '#bfdbfe');
  assert.equal(resolveCellBackground(grid, 0, 0), '#bfdbfe');

  grid = setRowColor(grid, 0, '#bbf7d0');
  assert.equal(resolveCellBackground(grid, 0, 0), '#bbf7d0');

  grid = applyFormat(grid, [{ rowIndex: 0, colIndex: 0 }], { highlight: '#fef08a' }).grid;
  assert.equal(resolveCellBackground(grid, 0, 0), '#fef08a');
});

test('an unpainted cell has no background at all', () => {
  assert.equal(resolveCellBackground(createEmptyGrid(), 0, 0), undefined);
});

test('a column colour reaches every row of that column', () => {
  const grid = setColumnColor(createEmptyGrid(), 1, '#bfdbfe');
  assert.equal(resolveCellBackground(grid, 0, 1), '#bfdbfe');
  assert.equal(resolveCellBackground(grid, 9, 1), '#bfdbfe');
  assert.equal(resolveCellBackground(grid, 0, 0), undefined);
});

test('deleting a row moves the row colours below it up', () => {
  let grid = createEmptyGrid();
  grid = setRowColor(grid, 0, '#fef08a');
  grid = setRowColor(grid, 2, '#bbf7d0');

  const { grid: next } = deleteRow(grid, 0);
  assert.equal(next.rowColors.has(0), false, 'the deleted row takes its colour with it');
  assert.equal(next.rowColors.get(1), '#bbf7d0', 'row 2 moved up to row 1');
});

test('colour maps round-trip through the shape the database stores', () => {
  const grid = setRowColor(setRowColor(createEmptyGrid(), 0, '#fef08a'), 3, '#bbf7d0');
  assert.deepEqual(bandMapToRecord(grid.rowColors), { '0': '#fef08a', '3': '#bbf7d0' });
});

test('stored colour maps are re-validated on the way back in', () => {
  // A bad value already in the database must never reach a style attribute.
  const grid = gridFromStoredCells(['A', 'B'], 5, [], {
    rowColors: { '0': '#fef08a', '1': 'url(javascript:alert(1))', x: '#ffffff' },
    columnColors: { '1': '#BFDBFE' },
  });

  assert.equal(grid.rowColors.get(0), '#fef08a');
  assert.equal(grid.rowColors.has(1), false);
  assert.equal(grid.rowColors.size, 1);
  assert.equal(grid.columnColors.get(1), '#bfdbfe', 'stored colours are normalised to lower case');
});

test('a stored sheet remembers its direction', () => {
  assert.equal(gridFromStoredCells(['A'], 5, [], { rtl: true }).rtl, true);
  assert.equal(gridFromStoredCells(['A'], 5, []).rtl, false);
});

// ------------------------------------------------------- formatting from an upload

test('an uploaded sheet keeps the colours of its cells', () => {
  const grid = gridFromAoa(
    [
      ['Applicant', 'Status'],
      ['Tamar', 'Open'],
    ],
    {
      styles: [[null, null], [null, { fill: '#92D050' }]],
    },
  );

  assert.equal(getFormat(grid, 0, 1)?.highlight, '#92d050');
  assert.equal(getFormat(grid, 0, 0), null);
});

test('a coloured header row becomes the column colours', () => {
  // A banded header in the uploaded file is a property of the column, not of one cell.
  const grid = gridFromAoa(
    [
      ['Applicant', 'Status'],
      ['Tamar', 'Open'],
    ],
    { styles: [[{ fill: '#bfdbfe' }, { fill: '#bfdbfe' }], [null, null]] },
  );

  assert.equal(grid.columnColors.get(0), '#bfdbfe');
  assert.equal(grid.columnColors.get(1), '#bfdbfe');
  assert.equal(getFormat(grid, 0, 0), null, 'the body cells are not individually painted');
});

test('a colour on an empty imported cell is kept', () => {
  // A colour-coded blank is how a spreadsheet marks something missing.
  const grid = gridFromAoa([['A'], ['']], { styles: [[null], [{ fill: '#fef08a' }]] });
  assert.equal(grid.cells.size, 0);
  assert.equal(getFormat(grid, 0, 0)?.highlight, '#fef08a');
});

test('an uploaded sheet with no styles imports cleanly', () => {
  const grid = gridFromAoa([['A'], ['x']], { styles: [] });
  assert.equal(grid.formats.size, 0);
  assert.equal(grid.columnColors.size, 0);
});

test('an uploaded sheet keeps its text colours, alignment, bold and borders', () => {
  const grid = gridFromAoa(
    [
      ['Applicant', 'Status'],
      ['Tamar', 'Open'],
    ],
    {
      hasHeaderRow: false,
      styles: [
        [{ fontColor: '#CC0000', bold: true }, { align: 'center' }],
        [{ align: 'right', borderBottom: true }, { fontSizePt: 20, underline: true }],
      ],
    },
  );

  assert.equal(getFormat(grid, 0, 0)?.textColor, '#cc0000');
  assert.equal(getFormat(grid, 0, 0)?.bold, true);
  assert.equal(getFormat(grid, 0, 1)?.align, 'center');
  assert.equal(getFormat(grid, 1, 0)?.align, 'right');
  assert.equal(getFormat(grid, 1, 0)?.borderBottom, true);
  assert.equal(getFormat(grid, 1, 1)?.fontSize, 24, '20pt is 26.7px, so the 24px size');
  assert.equal(getFormat(grid, 1, 1)?.underline, true);
});

test('a workbook font size becomes the nearest size this app offers', () => {
  // Points are three quarters of a pixel, so Excel's 11pt default is the app's normal 14px.
  assert.equal(fontSizeFromPoints(11), undefined, 'the default is stored as absent');
  assert.equal(fontSizeFromPoints(8), 11);
  assert.equal(fontSizeFromPoints(12), 16);
  assert.equal(fontSizeFromPoints(18), 24);
  assert.equal(fontSizeFromPoints(0), undefined);
  assert.equal(fontSizeFromPoints('nonsense'), undefined);
});

test('an imported style that says nothing becomes no format at all', () => {
  assert.equal(formatFromImportedStyle(null), null);
  assert.equal(formatFromImportedStyle({}), null);
  // 11pt and "automatic" are both defaults, so neither leaves a trace on the cell.
  assert.equal(formatFromImportedStyle({ fontSizePt: 11 }), null);
  assert.equal(formatFromImportedStyle({ bold: false, align: undefined }), null);
});

test('an imported colour is only kept when it is really a colour', () => {
  assert.equal(formatFromImportedStyle({ fontColor: 'rgb(1,2,3)' }), null);
  assert.equal(formatFromImportedStyle({ fontColor: '#12345' }), null);
  // Six hex digits without the hash is how a workbook writes them.
  assert.deepEqual(formatFromImportedStyle({ fontColor: 'CC0000' }), { textColor: '#cc0000' });
});

test('a stored cell remembers its text colour', () => {
  const grid = gridFromStoredCells(['A'], 3, [
    { row_index: 0, col_index: 0, value: 'x', text_color: '#1D4ED8' },
  ]);

  assert.equal(getFormat(grid, 0, 0)?.textColor, '#1d4ed8');
});

test('text colour and highlight are independent', () => {
  const format = normalizeFormat({ textColor: '#dc2626', highlight: '#fef08a' });
  assert.deepEqual(format, { highlight: '#fef08a', textColor: '#dc2626' });
});

/* ------------------------------------------------------------------ selection geometry */

test('clicking a row number selects that row across every column', () => {
  const grid = appendColumn(createEmptyGrid());
  const range = bandRange('row', 3, 3, grid);

  assert.deepEqual(range.anchor, { rowIndex: 3, colIndex: 0 });
  assert.deepEqual(range.focus, { rowIndex: 3, colIndex: grid.columns.length - 1 });
  assert.equal(rangeCells(range).length, grid.columns.length);
});

test('clicking a column heading selects that column down every row', () => {
  const grid = createEmptyGrid();
  const range = bandRange('column', 2, 2, grid);

  assert.deepEqual(range.anchor, { rowIndex: 0, colIndex: 2 });
  assert.deepEqual(range.focus, { rowIndex: grid.rowCount - 1, colIndex: 2 });
  assert.equal(rangeCells(range).length, grid.rowCount);
});

test('dragging across row numbers selects the whole band of rows', () => {
  const grid = createEmptyGrid();
  const cells = rangeCells(bandRange('row', 1, 4, grid));

  assert.equal(cells.length, 4 * grid.columns.length);
  assert.ok(cells.every((cell) => cell.rowIndex >= 1 && cell.rowIndex <= 4));
});

test('dragging backwards up the row numbers selects the same band', () => {
  const grid = createEmptyGrid();
  assert.deepEqual(
    rangeCells(bandRange('row', 4, 1, grid)),
    rangeCells(bandRange('row', 1, 4, grid)),
  );
});

test('a selected row is marked in the gutter, and its neighbours are not', () => {
  const grid = createEmptyGrid();
  const range = bandRange('row', 2, 2, grid);

  assert.equal(isRowFullySelected(range, 2, grid), true);
  assert.equal(isRowFullySelected(range, 1, grid), false);
  assert.equal(isRowFullySelected(range, 3, grid), false);
});

test('a block that stops short of the last column does not mark the row', () => {
  const grid = createEmptyGrid();
  const range = {
    anchor: { rowIndex: 2, colIndex: 0 },
    focus: { rowIndex: 2, colIndex: grid.columns.length - 2 },
  };

  assert.equal(isRowFullySelected(range, 2, grid), false);
});

test('a block dragged across every column marks the row, as in Excel', () => {
  const grid = createEmptyGrid();
  const range = {
    anchor: { rowIndex: 2, colIndex: 0 },
    focus: { rowIndex: 2, colIndex: grid.columns.length - 1 },
  };

  assert.equal(isRowFullySelected(range, 2, grid), true);
});

test('a selected column is marked in its heading, and its neighbours are not', () => {
  const grid = createEmptyGrid();
  const range = bandRange('column', 1, 2, grid);

  assert.equal(isColumnFullySelected(range, 1, grid), true);
  assert.equal(isColumnFullySelected(range, 2, grid), true);
  assert.equal(isColumnFullySelected(range, 0, grid), false);
  assert.equal(isColumnFullySelected(range, 3, grid), false);
});

test('a column band that does not reach the last row leaves the heading unmarked', () => {
  const grid = createEmptyGrid();
  const range = {
    anchor: { rowIndex: 0, colIndex: 1 },
    focus: { rowIndex: grid.rowCount - 2, colIndex: 1 },
  };

  assert.equal(isColumnFullySelected(range, 1, grid), false);
});

test('nothing is marked when there is no selection', () => {
  const grid = createEmptyGrid();

  assert.deepEqual(rangeCells(null), []);
  assert.equal(isRowFullySelected(null, 0, grid), false);
  assert.equal(isColumnFullySelected(null, 0, grid), false);
});

test('a row band covers rows beyond the sheet only up to the columns it has', () => {
  // Rows can be added, columns are fixed, so a row band is always the full known width.
  const grid = appendRows(appendColumn(createEmptyGrid()), 5);
  const range = bandRange('row', 0, grid.rowCount - 1, grid);

  assert.equal(rangeCells(range).length, grid.rowCount * grid.columns.length);
});

test('formatting a selected row reaches every cell in it', () => {
  const grid = createEmptyGrid();
  const range = bandRange('row', 1, 1, grid);
  const formatted = applyFormat(grid, rangeCells(range), { bold: true });

  for (let colIndex = 0; colIndex < grid.columns.length; colIndex += 1) {
    assert.equal(getFormat(formatted.grid, 1, colIndex)?.bold, true, `column ${colIndex}`);
  }
  assert.equal(getFormat(formatted.grid, 0, 0), null);
});

/* ------------------------------------------------------------------ alignment */

test('only the three real alignments are accepted', () => {
  for (const option of CASE_SHEET_ALIGNMENTS) {
    assert.equal(normalizeAlign(option), option);
  }
  assert.equal(normalizeAlign('CENTER'), 'center');
  assert.equal(normalizeAlign('  right '), 'right');
});

test('anything that is not an alignment is dropped', () => {
  // This value reaches a style attribute, so nothing unrecognised may survive.
  assert.equal(normalizeAlign('justify'), undefined);
  assert.equal(normalizeAlign('center; position:fixed'), undefined);
  assert.equal(normalizeAlign(''), undefined);
  assert.equal(normalizeAlign(null), undefined);
  assert.equal(normalizeAlign(undefined), undefined);
  assert.equal(normalizeAlign(3), undefined);
});

test('an alignment survives a round trip through a stored row', () => {
  const format = formatFromStoredCell({
    row_index: 0,
    col_index: 0,
    value: 'Tamar',
    align: 'center',
  });

  assert.equal(format?.align, 'center');
});

test('a stored alignment that is not one of the three is ignored', () => {
  const format = formatFromStoredCell({
    row_index: 0,
    col_index: 0,
    value: 'Tamar',
    align: 'middle',
  });

  assert.equal(format, null);
});

test('alignment alone is enough to count as formatting', () => {
  // A centred but plain cell must still be stored, or the alignment is lost on reload.
  assert.deepEqual(normalizeFormat({ align: 'right' }), { align: 'right' });
});

test('clearing the alignment leaves no trace behind', () => {
  let grid = applyFormat(createEmptyGrid(), [{ rowIndex: 0, colIndex: 0 }], {
    align: 'center',
  }).grid;
  grid = applyFormat(grid, [{ rowIndex: 0, colIndex: 0 }], { align: null }).grid;

  assert.equal(getFormat(grid, 0, 0), null);
});

test('alignment applies to every cell of a selected row', () => {
  const grid = createEmptyGrid();
  const { grid: next } = applyFormat(grid, rangeCells(bandRange('row', 2, 2, grid)), {
    align: 'center',
  });

  for (let colIndex = 0; colIndex < grid.columns.length; colIndex += 1) {
    assert.equal(getFormat(next, 2, colIndex)?.align, 'center');
  }
});

test('a selection with two different alignments reports no shared one', () => {
  let grid = applyFormat(createEmptyGrid(), [{ rowIndex: 0, colIndex: 0 }], {
    align: 'center',
  }).grid;
  grid = applyFormat(grid, [{ rowIndex: 0, colIndex: 1 }], { align: 'right' }).grid;

  const targets = [
    { rowIndex: 0, colIndex: 0 },
    { rowIndex: 0, colIndex: 1 },
  ];
  assert.equal(sharedFormatValue(grid, targets, 'align'), null);
});

/* ------------------------------------------------------------------ row and column sizes */

test('an untouched row and column report the default size', () => {
  const grid = createEmptyGrid();

  assert.equal(resolveRowHeight(grid, 0), CASE_SHEET_ROW_HEIGHT_DEFAULT);
  assert.equal(resolveColumnWidth(grid, 0), CASE_SHEET_COLUMN_WIDTH_DEFAULT);
});

test('a dragged size is remembered for that row or column alone', () => {
  let grid = setRowHeight(createEmptyGrid(), 2, 120);
  grid = setColumnWidth(grid, 1, 300);

  assert.equal(resolveRowHeight(grid, 2), 120);
  assert.equal(resolveRowHeight(grid, 3), CASE_SHEET_ROW_HEIGHT_DEFAULT);
  assert.equal(resolveColumnWidth(grid, 1), 300);
  assert.equal(resolveColumnWidth(grid, 0), CASE_SHEET_COLUMN_WIDTH_DEFAULT);
});

test('a size dragged past the limits is clamped rather than refused', () => {
  // Dragging well past the edge of the screen should stop at the limit, not undo the drag.
  const tall = setRowHeight(createEmptyGrid(), 0, 99999);
  const squashed = setRowHeight(createEmptyGrid(), 0, -50);
  const wide = setColumnWidth(createEmptyGrid(), 0, 99999);
  const thin = setColumnWidth(createEmptyGrid(), 0, 1);

  assert.equal(resolveRowHeight(tall, 0), CASE_SHEET_ROW_HEIGHT_MAX);
  assert.equal(resolveRowHeight(squashed, 0), CASE_SHEET_ROW_HEIGHT_MIN);
  assert.equal(resolveColumnWidth(wide, 0), CASE_SHEET_COLUMN_WIDTH_MAX);
  assert.equal(resolveColumnWidth(thin, 0), CASE_SHEET_COLUMN_WIDTH_MIN);
});

test('a size dragged back to the default stops being stored', () => {
  // Otherwise changing the default later would leave this row pinned to the old one.
  const grid = setRowHeight(
    setRowHeight(createEmptyGrid(), 0, 120),
    0,
    CASE_SHEET_ROW_HEIGHT_DEFAULT,
  );

  assert.deepEqual(sizeMapToRecord(grid.rowHeights), {});
});

test('clearing a size restores the default', () => {
  const grid = setRowHeight(setRowHeight(createEmptyGrid(), 0, 200), 0, null);

  assert.equal(resolveRowHeight(grid, 0), CASE_SHEET_ROW_HEIGHT_DEFAULT);
  assert.deepEqual(sizeMapToRecord(grid.rowHeights), {});
});

test('setting the size a row already has leaves the grid untouched', () => {
  const grid = setRowHeight(createEmptyGrid(), 0, 120);

  assert.equal(setRowHeight(grid, 0, 120), grid);
});

test('a dragged height follows its row when a row above is deleted', () => {
  const grid = setRowHeight(createEmptyGrid(), 3, 120);
  const { grid: next } = deleteRow(grid, 1);

  assert.equal(resolveRowHeight(next, 2), 120);
  assert.equal(resolveRowHeight(next, 3), CASE_SHEET_ROW_HEIGHT_DEFAULT);
});

test('deleting a row takes its height with it', () => {
  const grid = setRowHeight(createEmptyGrid(), 2, 120);
  const { grid: next } = deleteRow(grid, 2);

  assert.equal(resolveRowHeight(next, 2), CASE_SHEET_ROW_HEIGHT_DEFAULT);
});

test('sizes survive a round trip through stored records', () => {
  const grid = setColumnWidth(setRowHeight(createEmptyGrid(), 1, 90), 2, 240);
  const restored = gridFromStoredCells(grid.columns, grid.rowCount, [], {
    rowHeights: sizeMapToRecord(grid.rowHeights),
    columnWidths: sizeMapToRecord(grid.columnWidths),
  });

  assert.equal(resolveRowHeight(restored, 1), 90);
  assert.equal(resolveColumnWidth(restored, 2), 240);
});

test('stored sizes are re-validated on the way back in', () => {
  // These reach a style attribute and the table's own width, so junk must not survive a reload.
  const restored = gridFromStoredCells(['A'], 5, [], {
    rowHeights: { 0: 'tall', 1: 99999, '-2': 50, 3: null, 4: 80 },
    columnWidths: { 0: '240' },
  });

  assert.equal(restored.rowHeights.has(0), false);
  assert.equal(resolveRowHeight(restored, 1), CASE_SHEET_ROW_HEIGHT_MAX);
  assert.equal(restored.rowHeights.has(-2), false);
  assert.equal(restored.rowHeights.has(3), false);
  assert.equal(resolveRowHeight(restored, 4), 80);
  assert.equal(resolveColumnWidth(restored, 0), 240);
});

test('a colleague resizing a column reaches the local grid', () => {
  const grid = createEmptyGrid();
  const next = applyRemoteShape(grid, {
    columns: grid.columns,
    rowCount: grid.rowCount,
    columnWidths: { 1: 300 },
    rowHeights: { 0: 60 },
  });

  assert.equal(resolveColumnWidth(next, 1), 300);
  assert.equal(resolveRowHeight(next, 0), 60);
});

test('a remote shape never shrinks the sheet under rows being typed into', () => {
  // The sender did not know about rows added here since, and losing them would hide live cells.
  const grid = appendRows(createEmptyGrid(), 40);
  const next = applyRemoteShape(grid, { columns: grid.columns, rowCount: 5 });

  assert.equal(next.rowCount, grid.rowCount);
});

test('a remote shape with no columns keeps the ones already on screen', () => {
  const grid = renameColumn(createEmptyGrid(), 0, 'Applicant');
  const next = applyRemoteShape(grid, { columns: [], rowCount: grid.rowCount });

  assert.deepEqual(next.columns, grid.columns);
});

/* ------------------------------------------------------------------ row and column lines */

const block = (rowFrom: number, colFrom: number, rowTo: number, colTo: number) => ({
  anchor: { rowIndex: rowFrom, colIndex: colFrom },
  focus: { rowIndex: rowTo, colIndex: colTo },
});

test('all borders puts a line on every edge of every selected cell', () => {
  const { grid } = applyBorderPreset(createEmptyGrid(), block(0, 0, 1, 1), 'all');

  for (const [row, col] of [[0, 0], [0, 1], [1, 0], [1, 1]]) {
    const format = getFormat(grid, row, col);
    assert.deepEqual(
      {
        top: format?.borderTop,
        right: format?.borderRight,
        bottom: format?.borderBottom,
        left: format?.borderLeft,
      },
      { top: true, right: true, bottom: true, left: true },
      `${row}:${col}`,
    );
  }
});

test('outside borders trace the perimeter and leave the inside bare', () => {
  const { grid } = applyBorderPreset(createEmptyGrid(), block(0, 0, 2, 2), 'outline');

  // A corner gets two edges, an edge cell one, and the middle none at all.
  assert.deepEqual(getFormat(grid, 0, 0), { borderTop: true, borderLeft: true });
  assert.deepEqual(getFormat(grid, 2, 2), { borderBottom: true, borderRight: true });
  assert.deepEqual(getFormat(grid, 0, 1), { borderTop: true });
  assert.equal(getFormat(grid, 1, 1), null);
});

test('outside borders on a middle cell record no change at all', () => {
  // Writing a no-op row for every interior cell would put a 3x3 block of pointless saves on the wire.
  const { changes } = applyBorderPreset(createEmptyGrid(), block(0, 0, 2, 2), 'outline');

  assert.equal(changes.length, 8);
});

test('a single line goes on that edge of every selected cell', () => {
  // Selecting a row and asking for a bottom line is how a handler draws a line under it.
  const grid = createEmptyGrid();
  const { grid: next } = applyBorderPreset(grid, bandRange('row', 1, 1, grid), 'bottom');

  for (let colIndex = 0; colIndex < grid.columns.length; colIndex += 1) {
    assert.deepEqual(getFormat(next, 1, colIndex), { borderBottom: true }, `column ${colIndex}`);
  }
});

test('adding a line leaves the lines already there alone', () => {
  let grid = applyBorderPreset(createEmptyGrid(), block(0, 0, 0, 0), 'outline').grid;
  grid = applyBorderPreset(grid, block(0, 0, 0, 0), 'bottom').grid;

  assert.equal(getFormat(grid, 0, 0)?.borderTop, true);
  assert.equal(getFormat(grid, 0, 0)?.borderBottom, true);
});

test('clearing lines removes all four edges and nothing else', () => {
  let grid = applyFormat(createEmptyGrid(), [{ rowIndex: 0, colIndex: 0 }], {
    bold: true,
  }).grid;
  grid = applyBorderPreset(grid, block(0, 0, 0, 0), 'all').grid;
  grid = applyBorderPreset(grid, block(0, 0, 0, 0), 'none').grid;

  assert.deepEqual(getFormat(grid, 0, 0), { bold: true });
});

test('lines on a cell with no text are still worth saving', () => {
  // A line is drawn on the cell, not on its contents, so a blank bordered cell must persist.
  const { changes } = applyBorderPreset(createEmptyGrid(), block(0, 0, 0, 0), 'all');

  assert.equal(changes.length, 1);
  assert.equal(changes[0].value, '');
  assert.equal(changes[0].format?.borderTop, true);
});

test('lines survive a round trip through stored rows', () => {
  const format = formatFromStoredCell({
    row_index: 0,
    col_index: 0,
    value: '',
    border_top: true,
    border_left: true,
  });

  assert.deepEqual(format, { borderTop: true, borderLeft: true });
});

test('asking for lines with nothing selected changes nothing', () => {
  const grid = createEmptyGrid();
  const result = applyBorderPreset(grid, null, 'all');

  assert.equal(result.grid, grid);
  assert.deepEqual(result.changes, []);
});

/* ------------------------------------------------------------------ sizes from a workbook */

test('column widths and row heights come in from an uploaded workbook', () => {
  const grid = gridFromAoa(
    [
      ['Applicant', 'Document'],
      ['Tamar', 'Birth certificate'],
      ['Daniel', 'Passport'],
    ],
    { columnWidths: [195, null], rowHeights: [20, 56, null] },
  );

  assert.equal(resolveColumnWidth(grid, 0), 195);
  assert.equal(resolveColumnWidth(grid, 1), CASE_SHEET_COLUMN_WIDTH_DEFAULT);
  // The first height belongs to the heading row, which is not one of the grid's rows.
  assert.equal(resolveRowHeight(grid, 0), 56);
  assert.equal(resolveRowHeight(grid, 1), CASE_SHEET_ROW_HEIGHT_DEFAULT);
});

test('an imported size outside the limits is clamped, not dropped', () => {
  const grid = gridFromAoa([['A'], ['x']], { columnWidths: [5000], rowHeights: [null, 2] });

  assert.equal(resolveColumnWidth(grid, 0), CASE_SHEET_COLUMN_WIDTH_MAX);
  assert.equal(resolveRowHeight(grid, 0), CASE_SHEET_ROW_HEIGHT_MIN);
});

test('a workbook with no sizes leaves every row and column at the default', () => {
  const grid = gridFromAoa([['A', 'B'], ['x', 'y']]);

  assert.deepEqual(sizeMapToRecord(grid.columnWidths), {});
  assert.deepEqual(sizeMapToRecord(grid.rowHeights), {});
});

test('an imported width that equals the default is not stored as an override', () => {
  const grid = gridFromAoa([['A'], ['x']], {
    columnWidths: [CASE_SHEET_COLUMN_WIDTH_DEFAULT],
  });

  assert.deepEqual(sizeMapToRecord(grid.columnWidths), {});
});
