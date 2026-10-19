/**
 * Grid maths for the Case Handling sheet: Excel in, Excel out, and the bookkeeping in between.
 *
 * Everything here is pure so it can be tested without a browser or a database. The Supabase calls
 * live in caseSheetApi and the editing surface in CaseHandlingTab.
 *
 * Cells are addressed by row and column index, not by a column schema, because an uploaded workbook
 * can be any shape and a handler can add columns as the case develops.
 */

/** Sparse by design: a blank cell is an absent key, not an empty string, so saves stay small. */
export type CaseSheetCellMap = Map<string, string>;

/**
 * How a cell is drawn. Absent properties mean "the sheet default", so an unformatted cell has no
 * entry at all and formatting costs nothing until someone uses it.
 */
export type CaseSheetAlign = 'left' | 'center' | 'right';

export type CaseSheetCellFormat = {
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
  /** Background fill. */
  highlight?: string;
  /** Text colour. Absent means the sheet's own ink, so changing that default reflows every sheet. */
  textColor?: string;
  fontSize?: number;
  /**
   * Left unset the cell follows the sheet's direction, which is why there is no default value here:
   * in a right-to-left sheet "unset" already means right-aligned, so storing 'left' as a default
   * would silently flip every Hebrew cell.
   */
  align?: CaseSheetAlign;
  /**
   * Explicit lines on a cell's edges — the row and column lines Excel calls borders. Separate from
   * the light grid the sheet always draws, which is a view detail rather than part of the data.
   */
  borderTop?: boolean;
  borderRight?: boolean;
  borderBottom?: boolean;
  borderLeft?: boolean;
};

export type CaseSheetBorderEdge = 'borderTop' | 'borderRight' | 'borderBottom' | 'borderLeft';

/** What the Borders menu offers, in the order Excel puts them. */
export type CaseSheetBorderPreset =
  | 'all'
  | 'outline'
  | 'top'
  | 'right'
  | 'bottom'
  | 'left'
  | 'none';

export type CaseSheetFormatMap = Map<string, CaseSheetCellFormat>;

/** Whole-row and whole-column fills, keyed by index. */
export type CaseSheetBandMap = Map<number, string>;

/** Hand-resized row heights and column widths in pixels, keyed by index. */
export type CaseSheetSizeMap = Map<number, number>;

export type CaseSheetGrid = {
  columns: string[];
  rowCount: number;
  cells: CaseSheetCellMap;
  /** Kept beside the text rather than inside it so a cell can be styled while still being empty. */
  formats: CaseSheetFormatMap;
  /**
   * Right-to-left, which mirrors the column order so column A sits on the right. A property of the
   * sheet, not of its text: a Hebrew sheet reads right to left even where a cell holds a number.
   */
  rtl: boolean;
  rowColors: CaseSheetBandMap;
  columnColors: CaseSheetBandMap;
  /**
   * Only the rows and columns someone has actually dragged. Everything else falls back to the
   * default, so changing that default later reflows every untouched sheet instead of leaving them
   * pinned to a size nobody chose.
   */
  rowHeights: CaseSheetSizeMap;
  columnWidths: CaseSheetSizeMap;
};

/**
 * One cell's complete state, which is what a save writes.
 *
 * Text and formatting travel together even when only one of them changed, because a save upserts the
 * whole row — sending only the changed half would reset the other half to its default.
 */
export type CaseSheetCellChange = {
  rowIndex: number;
  colIndex: number;
  value: string;
  format: CaseSheetCellFormat | null;
};

/**
 * The colours the pickers offer.
 *
 * Not a closed set, though: an uploaded workbook arrives with whatever colours its author chose, and
 * squeezing those into six swatches would misrepresent the handler's own file. Anything stored is
 * checked for shape instead, by `normalizeHighlight`.
 */
export const CASE_SHEET_HIGHLIGHTS: { label: string; value: string }[] = [
  { label: 'Yellow', value: '#fef08a' },
  { label: 'Green', value: '#bbf7d0' },
  { label: 'Blue', value: '#bfdbfe' },
  { label: 'Pink', value: '#fbcfe8' },
  { label: 'Orange', value: '#fed7aa' },
  { label: 'Grey', value: '#e5e7eb' },
];

/**
 * The text colours the picker offers. Open in the same way as the highlights, and for the same
 * reason: an uploaded workbook brings its author's own colours with it.
 */
export const CASE_SHEET_TEXT_COLORS: { label: string; value: string }[] = [
  { label: 'Black', value: '#111827' },
  { label: 'Grey', value: '#6b7280' },
  { label: 'Red', value: '#dc2626' },
  { label: 'Orange', value: '#ea580c' },
  { label: 'Green', value: '#15803d' },
  { label: 'Blue', value: '#1d4ed8' },
  { label: 'Purple', value: '#7e22ce' },
];

/** Text sizes on offer, in pixels. Also a closed list, for the same reasons. */
export const CASE_SHEET_ALIGNMENTS: CaseSheetAlign[] = ['left', 'center', 'right'];

/** Matches the `h-9` and `min-w-[160px]` the grid used before anything could be resized. */
export const CASE_SHEET_ROW_HEIGHT_DEFAULT = 36;
export const CASE_SHEET_COLUMN_WIDTH_DEFAULT = 160;

/** A row still has to be clickable, and a column still has to fit on a screen. */
export const CASE_SHEET_ROW_HEIGHT_MIN = 24;
export const CASE_SHEET_ROW_HEIGHT_MAX = 480;
export const CASE_SHEET_COLUMN_WIDTH_MIN = 56;
export const CASE_SHEET_COLUMN_WIDTH_MAX = 960;

export const CASE_SHEET_FONT_SIZES = [11, 12, 14, 16, 20, 24];
export const CASE_SHEET_FONT_SIZE_DEFAULT = 14;

export const CASE_SHEET_MAX_ROWS = 20000;
export const CASE_SHEET_MAX_COLUMNS = 512;
export const CASE_SHEET_MAX_CELL_LENGTH = 8192;

/** A new sheet opens with room to type rather than a single square. */
export const CASE_SHEET_DEFAULT_ROWS = 25;
const CASE_SHEET_DEFAULT_COLUMNS = 6;

/** Keys must match the database primary key, so row and column travel together as one string. */
export function cellKey(rowIndex: number, colIndex: number): string {
  return `${rowIndex}:${colIndex}`;
}

export function parseCellKey(key: string): { rowIndex: number; colIndex: number } | null {
  const [row, col] = String(key).split(':');
  const rowIndex = Number(row);
  const colIndex = Number(col);
  if (!Number.isInteger(rowIndex) || !Number.isInteger(colIndex)) return null;
  if (rowIndex < 0 || colIndex < 0) return null;
  return { rowIndex, colIndex };
}

/** Spreadsheet column names: 0 is A, 25 is Z, 26 is AA. Used for headers a sheet never named. */
export function columnLabel(colIndex: number): string {
  if (!Number.isInteger(colIndex) || colIndex < 0) return '';
  let label = '';
  let n = colIndex;
  while (n >= 0) {
    label = String.fromCharCode(65 + (n % 26)) + label;
    n = Math.floor(n / 26) - 1;
  }
  return label;
}

/**
 * Trailing whitespace is dropped but inner spacing is kept, and the value is capped to what the
 * column accepts. Returning '' means the cell is blank and its row should be removed, not stored.
 */
export function normalizeCellValue(value: unknown): string {
  if (value == null) return '';
  const text = typeof value === 'string' ? value : String(value);
  // No newlines: a cell is one line, and a pasted multi-line block becomes multiple rows instead.
  return text.replace(/[\r\n]+/g, ' ').trim().slice(0, CASE_SHEET_MAX_CELL_LENGTH);
}

/**
 * A colour, or nothing.
 *
 * This value is written into a style attribute, so the shape is pinned rather than trusted: a
 * six-digit hex colour cannot carry anything but a colour. Checked on the way in and again on the
 * way out, so even a bad value already sitting in the database never reaches the browser's styles.
 *
 * `RRGGBB` without the hash is accepted because that is how a workbook's own fills arrive.
 */
export function normalizeHighlight(value: unknown): string | undefined {
  const text = String(value ?? '').trim().toLowerCase();
  if (!text) return undefined;

  const hex = text.startsWith('#') ? text.slice(1) : text;
  if (!/^[0-9a-f]{6}$/.test(hex)) return undefined;
  return `#${hex}`;
}

/**
 * Whether a string contains Hebrew (or Arabic) letters.
 *
 * Used to decide a sheet's direction when the uploaded workbook does not say, and nothing else —
 * individual cells get `dir="auto"` in the markup, which lets the browser judge each one.
 */
export function containsRtlText(value: unknown): boolean {
  // Hebrew, Hebrew presentation forms, and Arabic, which share the same reading direction.
  return /[\u0590-\u05ff\ufb1d-\ufb4f\u0600-\u06ff]/.test(String(value ?? ''));
}

/**
 * Decides whether a sheet of text reads right to left.
 *
 * A sheet is mirrored only when right-to-left text is the majority, not merely present: a mostly
 * English sheet with one Hebrew name in it should stay as its author laid it out. Cells with no
 * letters at all — dates, numbers, references — do not get a vote either way.
 */
export function detectRtl(rows: unknown[][]): boolean {
  let rtl = 0;
  let ltr = 0;

  for (const row of rows ?? []) {
    for (const value of row ?? []) {
      const text = String(value ?? '').trim();
      if (!text) continue;
      if (containsRtlText(text)) rtl += 1;
      else if (/[a-z]/i.test(text)) ltr += 1;
    }
  }

  return rtl > ltr;
}

function bandMapFromRecord(value: unknown): CaseSheetBandMap {
  const map: CaseSheetBandMap = new Map();
  if (!value || typeof value !== 'object') return map;

  for (const [key, color] of Object.entries(value as Record<string, unknown>)) {
    const index = Number(key);
    if (!Number.isInteger(index) || index < 0) continue;
    const normalized = normalizeHighlight(color);
    if (normalized) map.set(index, normalized);
  }
  return map;
}

/** Back to the plain object the database column holds. */
export function bandMapToRecord(map: CaseSheetBandMap): Record<string, string> {
  const record: Record<string, string> = {};
  for (const [index, color] of map) record[String(index)] = color;
  return record;
}

export function clampRowHeight(value: unknown): number {
  const height = Math.round(Number(value));
  if (!Number.isFinite(height)) return CASE_SHEET_ROW_HEIGHT_DEFAULT;
  return Math.min(CASE_SHEET_ROW_HEIGHT_MAX, Math.max(CASE_SHEET_ROW_HEIGHT_MIN, height));
}

export function clampColumnWidth(value: unknown): number {
  const width = Math.round(Number(value));
  if (!Number.isFinite(width)) return CASE_SHEET_COLUMN_WIDTH_DEFAULT;
  return Math.min(CASE_SHEET_COLUMN_WIDTH_MAX, Math.max(CASE_SHEET_COLUMN_WIDTH_MIN, width));
}

/**
 * Reads a stored size map, dropping anything that is not a usable index and size.
 *
 * A size ends up in a style attribute and in the table's own width, so a junk value would either be
 * ignored by the browser or collapse the layout. Clamping here means the rest of the grid can treat
 * every entry as a real number of pixels.
 */
function sizeMapFromRecord(value: unknown, clamp: (value: unknown) => number): CaseSheetSizeMap {
  const map: CaseSheetSizeMap = new Map();
  if (!value || typeof value !== 'object') return map;

  for (const [key, size] of Object.entries(value as Record<string, unknown>)) {
    const index = Number(key);
    if (!Number.isInteger(index) || index < 0) continue;
    if (size == null || Number.isNaN(Number(size))) continue;
    map.set(index, clamp(size));
  }
  return map;
}

export function sizeMapToRecord(map: CaseSheetSizeMap): Record<string, number> {
  const record: Record<string, number> = {};
  for (const [index, size] of map) record[String(index)] = size;
  return record;
}

/** The height a row is drawn at, which is the default unless someone has dragged it. */
export function resolveRowHeight(grid: CaseSheetGrid, rowIndex: number): number {
  return grid.rowHeights.get(rowIndex) ?? CASE_SHEET_ROW_HEIGHT_DEFAULT;
}

export function resolveColumnWidth(grid: CaseSheetGrid, colIndex: number): number {
  return grid.columnWidths.get(colIndex) ?? CASE_SHEET_COLUMN_WIDTH_DEFAULT;
}

/** Null restores the default, which is stored as an absent entry rather than as the number. */
export function setRowHeight(
  grid: CaseSheetGrid,
  rowIndex: number,
  height: number | null,
): CaseSheetGrid {
  const next = height == null ? undefined : clampRowHeight(height);
  if ((grid.rowHeights.get(rowIndex) ?? undefined) === next) return grid;

  const rowHeights = new Map(grid.rowHeights);
  if (next === undefined || next === CASE_SHEET_ROW_HEIGHT_DEFAULT) rowHeights.delete(rowIndex);
  else rowHeights.set(rowIndex, next);

  return { ...grid, rowHeights };
}

export function setColumnWidth(
  grid: CaseSheetGrid,
  colIndex: number,
  width: number | null,
): CaseSheetGrid {
  const next = width == null ? undefined : clampColumnWidth(width);
  if ((grid.columnWidths.get(colIndex) ?? undefined) === next) return grid;

  const columnWidths = new Map(grid.columnWidths);
  if (next === undefined || next === CASE_SHEET_COLUMN_WIDTH_DEFAULT) columnWidths.delete(colIndex);
  else columnWidths.set(colIndex, next);

  return { ...grid, columnWidths };
}

export function setRowColor(
  grid: CaseSheetGrid,
  rowIndex: number,
  color: string | null,
): CaseSheetGrid {
  const normalized = color == null ? undefined : normalizeHighlight(color);
  if ((grid.rowColors.get(rowIndex) ?? undefined) === normalized) return grid;

  const rowColors = new Map(grid.rowColors);
  if (normalized) rowColors.set(rowIndex, normalized);
  else rowColors.delete(rowIndex);

  return { ...grid, rowColors, rowCount: Math.max(grid.rowCount, rowIndex + 1) };
}

export function setColumnColor(
  grid: CaseSheetGrid,
  colIndex: number,
  color: string | null,
): CaseSheetGrid {
  const normalized = color == null ? undefined : normalizeHighlight(color);
  if ((grid.columnColors.get(colIndex) ?? undefined) === normalized) return grid;

  const columnColors = new Map(grid.columnColors);
  if (normalized) columnColors.set(colIndex, normalized);
  else columnColors.delete(colIndex);

  return { ...grid, columnColors };
}

/**
 * The colour a cell is actually drawn in.
 *
 * Narrowest wins: a cell the handler highlighted outranks the row it sits in, which outranks the
 * column. Anything else would make a deliberate cell highlight invisible the moment its row was
 * painted.
 */
export function resolveCellBackground(
  grid: CaseSheetGrid,
  rowIndex: number,
  colIndex: number,
): string | undefined {
  return (
    getFormat(grid, rowIndex, colIndex)?.highlight ??
    grid.rowColors.get(rowIndex) ??
    grid.columnColors.get(colIndex)
  );
}

/** The default size is stored as absent, so "normal" text never carries a size at all. */
export function normalizeAlign(value: unknown): CaseSheetAlign | undefined {
  const align = typeof value === 'string' ? value.trim().toLowerCase() : '';
  return (CASE_SHEET_ALIGNMENTS as string[]).includes(align)
    ? (align as CaseSheetAlign)
    : undefined;
}

export function normalizeFontSize(value: unknown): number | undefined {
  const size = Number(value);
  if (!CASE_SHEET_FONT_SIZES.includes(size)) return undefined;
  return size === CASE_SHEET_FONT_SIZE_DEFAULT ? undefined : size;
}

/**
 * A workbook's font size, in points, as one of the sizes this app offers.
 *
 * Points are three quarters of a pixel, and the result is snapped to the nearest size on the menu:
 * a stored size has to be one of them, and a sheet written in 10pt should still look smaller than
 * its 14pt headings rather than being dropped for not matching exactly.
 */
export function fontSizeFromPoints(points: unknown): number | undefined {
  const pt = Number(points);
  if (!Number.isFinite(pt) || pt <= 0) return undefined;

  const pixels = (pt * 4) / 3;
  const nearest = CASE_SHEET_FONT_SIZES.reduce((best, size) =>
    Math.abs(size - pixels) < Math.abs(best - pixels) ? size : best,
  );

  return normalizeFontSize(nearest);
}

/**
 * Formatting as an uploaded workbook declares it, before it is anything this app can draw.
 *
 * Structurally what `readXlsxCellStyles` returns. Named separately so the grid owns the mapping
 * into its own types and the reader stays a reader.
 */
export type CaseSheetImportedStyle = {
  fill?: string;
  fontColor?: string;
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
  fontSizePt?: number;
  align?: CaseSheetAlign;
  borderTop?: boolean;
  borderRight?: boolean;
  borderBottom?: boolean;
  borderLeft?: boolean;
};

export function formatFromImportedStyle(
  style: CaseSheetImportedStyle | null | undefined,
): CaseSheetCellFormat | null {
  if (!style) return null;

  return normalizeFormat({
    bold: style.bold === true,
    italic: style.italic === true,
    underline: style.underline === true,
    highlight: normalizeHighlight(style.fill),
    textColor: normalizeHighlight(style.fontColor),
    fontSize: fontSizeFromPoints(style.fontSizePt),
    align: normalizeAlign(style.align),
    borderTop: style.borderTop === true,
    borderRight: style.borderRight === true,
    borderBottom: style.borderBottom === true,
    borderLeft: style.borderLeft === true,
  });
}

/**
 * Strips a format down to what actually differs from the default, and returns null when nothing
 * does.
 *
 * Without this, switching bold on and off again would leave `{ bold: false }` behind, and the cell
 * would read as formatted forever — including in the "is this cell bold" checks the toolbar relies
 * on.
 */
export function normalizeFormat(
  format: CaseSheetCellFormat | null | undefined,
): CaseSheetCellFormat | null {
  if (!format) return null;

  const next: CaseSheetCellFormat = {};
  if (format.bold) next.bold = true;
  if (format.italic) next.italic = true;
  if (format.underline) next.underline = true;
  if (format.borderTop) next.borderTop = true;
  if (format.borderRight) next.borderRight = true;
  if (format.borderBottom) next.borderBottom = true;
  if (format.borderLeft) next.borderLeft = true;

  const highlight = normalizeHighlight(format.highlight);
  if (highlight) next.highlight = highlight;

  const textColor = normalizeHighlight(format.textColor);
  if (textColor) next.textColor = textColor;

  const fontSize = normalizeFontSize(format.fontSize);
  if (fontSize) next.fontSize = fontSize;

  const align = normalizeAlign(format.align);
  if (align) next.align = align;

  return Object.keys(next).length > 0 ? next : null;
}

export function createEmptyGrid(): CaseSheetGrid {
  return {
    columns: Array.from({ length: CASE_SHEET_DEFAULT_COLUMNS }, (_, i) => columnLabel(i)),
    rowCount: CASE_SHEET_DEFAULT_ROWS,
    cells: new Map(),
    formats: new Map(),
    rtl: false,
    rowColors: new Map(),
    columnColors: new Map(),
    rowHeights: new Map(),
    columnWidths: new Map(),
  };
}

export function getCell(grid: CaseSheetGrid, rowIndex: number, colIndex: number): string {
  return grid.cells.get(cellKey(rowIndex, colIndex)) ?? '';
}

export function getFormat(
  grid: CaseSheetGrid,
  rowIndex: number,
  colIndex: number,
): CaseSheetCellFormat | null {
  return grid.formats.get(cellKey(rowIndex, colIndex)) ?? null;
}

/**
 * A cell's whole state, ready to be saved.
 *
 * Every caller builds changes through here so that a text edit cannot accidentally drop the cell's
 * formatting, nor a formatting change its text.
 */
export function cellChange(
  grid: CaseSheetGrid,
  rowIndex: number,
  colIndex: number,
): CaseSheetCellChange {
  return {
    rowIndex,
    colIndex,
    value: getCell(grid, rowIndex, colIndex),
    format: getFormat(grid, rowIndex, colIndex),
  };
}

/** Whether a toolbar toggle should read as on, which it does only when every cell agrees. */
export function isFormatActive(
  grid: CaseSheetGrid,
  targets: { rowIndex: number; colIndex: number }[],
  key: 'bold' | 'italic' | 'underline',
): boolean {
  if (targets.length === 0) return false;
  return targets.every((target) => getFormat(grid, target.rowIndex, target.colIndex)?.[key] === true);
}

/**
 * The size or highlight shared by every selected cell, or null when they disagree.
 *
 * Returning null for a mixed selection is what stops the dropdowns from claiming a value the
 * selection does not actually have.
 */
export function sharedFormatValue<K extends 'highlight' | 'fontSize'>(
  grid: CaseSheetGrid,
  targets: { rowIndex: number; colIndex: number }[],
  key: K,
): CaseSheetCellFormat[K] | null {
  if (targets.length === 0) return null;
  const first = getFormat(grid, targets[0].rowIndex, targets[0].colIndex)?.[key] ?? null;
  for (const target of targets.slice(1)) {
    const value = getFormat(grid, target.rowIndex, target.colIndex)?.[key] ?? null;
    if (value !== first) return null;
  }
  return first as CaseSheetCellFormat[K] | null;
}

/**
 * Applies a formatting change to every selected cell.
 *
 * A property set to null in the patch clears it; a property left out is untouched, so turning on a
 * highlight does not also wipe whatever size the cell had.
 */
/**
 * Draws or clears the lines on a selected block, the way the Borders menu does in Excel.
 *
 * Needs the whole rectangle rather than a flat list of cells because "outline" means the perimeter
 * of the block — which cell gets a top line depends on where that cell sits inside the selection.
 *
 * Only "none" takes lines away. Adding a bottom line to a block that already has an outline leaves
 * the outline alone, which is what makes the menu additive the way Excel's is.
 */
export function applyBorderPreset(
  grid: CaseSheetGrid,
  range: CaseSheetRange | null,
  preset: CaseSheetBorderPreset,
): { grid: CaseSheetGrid; changes: CaseSheetCellChange[] } {
  if (!range) return { grid, changes: [] };

  const { rowFrom, rowTo, colFrom, colTo } = rangeBounds(range);
  const edgesFor = (rowIndex: number, colIndex: number): Partial<
    Record<CaseSheetBorderEdge, boolean | null>
  > => {
    switch (preset) {
      case 'all':
        return { borderTop: true, borderRight: true, borderBottom: true, borderLeft: true };
      case 'outline':
        return {
          borderTop: rowIndex === rowFrom ? true : undefined,
          borderBottom: rowIndex === rowTo ? true : undefined,
          borderLeft: colIndex === colFrom ? true : undefined,
          borderRight: colIndex === colTo ? true : undefined,
        };
      case 'top':
        return { borderTop: true };
      case 'right':
        return { borderRight: true };
      case 'bottom':
        return { borderBottom: true };
      case 'left':
        return { borderLeft: true };
      case 'none':
        return { borderTop: null, borderRight: null, borderBottom: null, borderLeft: null };
    }
  };

  let next = grid;
  const changes: CaseSheetCellChange[] = [];

  for (let rowIndex = rowFrom; rowIndex <= rowTo; rowIndex += 1) {
    for (let colIndex = colFrom; colIndex <= colTo; colIndex += 1) {
      const patch = edgesFor(rowIndex, colIndex);
      /*
       * An "outline" cell in the middle of the block has nothing to change, and applying an empty
       * patch would still record a no-op write for it.
       */
      const meaningful = Object.values(patch).some((value) => value !== undefined);
      if (!meaningful) continue;

      const applied = applyFormat(next, [{ rowIndex, colIndex }], patch);
      next = applied.grid;
      changes.push(...applied.changes);
    }
  }

  return { grid: next, changes };
}

export function applyFormat(
  grid: CaseSheetGrid,
  targets: { rowIndex: number; colIndex: number }[],
  patch: { [K in keyof CaseSheetCellFormat]?: CaseSheetCellFormat[K] | null },
): { grid: CaseSheetGrid; changes: CaseSheetCellChange[] } {
  const formats: CaseSheetFormatMap = new Map(grid.formats);
  const changes: CaseSheetCellChange[] = [];
  let rowCount = grid.rowCount;
  let columnCount = grid.columns.length;

  for (const target of targets) {
    const key = cellKey(target.rowIndex, target.colIndex);
    const previous = grid.formats.get(key) ?? null;

    const merged: CaseSheetCellFormat = { ...previous };
    for (const [property, value] of Object.entries(patch)) {
      if (value == null || value === false) delete merged[property as keyof CaseSheetCellFormat];
      else (merged as Record<string, unknown>)[property] = value;
    }

    const next = normalizeFormat(merged);
    const unchanged =
      JSON.stringify(normalizeFormat(previous) ?? {}) === JSON.stringify(next ?? {});
    if (unchanged) continue;

    if (next) formats.set(key, next);
    else formats.delete(key);

    rowCount = Math.max(rowCount, target.rowIndex + 1);
    columnCount = Math.max(columnCount, target.colIndex + 1);
    changes.push({
      rowIndex: target.rowIndex,
      colIndex: target.colIndex,
      value: getCell(grid, target.rowIndex, target.colIndex),
      format: next,
    });
  }

  if (changes.length === 0) return { grid, changes };

  const columns =
    columnCount > grid.columns.length
      ? Array.from({ length: columnCount }, (_, col) => grid.columns[col] ?? columnLabel(col))
      : grid.columns;

  return { grid: { ...grid, formats, rowCount, columns }, changes };
}

/**
 * Applies an edit and reports whether anything actually changed.
 *
 * The caller needs to know, because an unchanged cell must not be queued for saving and must not be
 * broadcast — retyping the same value would otherwise bump `updated_by` and make it look as though a
 * colleague had overwritten the cell.
 */
export function setCell(
  grid: CaseSheetGrid,
  rowIndex: number,
  colIndex: number,
  rawValue: unknown,
): { grid: CaseSheetGrid; changed: boolean } {
  const value = normalizeCellValue(rawValue);
  const key = cellKey(rowIndex, colIndex);
  const previous = grid.cells.get(key) ?? '';
  if (previous === value) return { grid, changed: false };

  // Clearing the text leaves the formatting in place, so emptying a highlighted cell keeps its
  // highlight rather than quietly resetting it.
  const cells = new Map(grid.cells);
  if (value === '') cells.delete(key);
  else cells.set(key, value);

  return {
    grid: {
      ...grid,
      cells,
      // Typing below the last row grows the sheet, the way dragging past the end would in Excel.
      rowCount: Math.max(grid.rowCount, rowIndex + 1),
    },
    changed: true,
  };
}

export function appendRows(grid: CaseSheetGrid, count = 1): CaseSheetGrid {
  const rowCount = Math.min(CASE_SHEET_MAX_ROWS, grid.rowCount + Math.max(1, count));
  return { ...grid, rowCount };
}

export function appendColumn(grid: CaseSheetGrid, label?: string): CaseSheetGrid {
  if (grid.columns.length >= CASE_SHEET_MAX_COLUMNS) return grid;
  const next = label?.trim() || columnLabel(grid.columns.length);
  return { ...grid, columns: [...grid.columns, next] };
}

export function renameColumn(grid: CaseSheetGrid, colIndex: number, label: string): CaseSheetGrid {
  if (colIndex < 0 || colIndex >= grid.columns.length) return grid;
  const columns = [...grid.columns];
  // An emptied header falls back to its letter, so a column is never nameless.
  columns[colIndex] = normalizeCellValue(label) || columnLabel(colIndex);
  return { ...grid, columns };
}

/**
 * Drops a row and shifts everything below it up, which is the only operation here that has to
 * rewrite other cells' addresses — hence it returns the full set of changes to persist rather than
 * just the new grid.
 */
export function deleteRow(
  grid: CaseSheetGrid,
  rowIndex: number,
): { grid: CaseSheetGrid; changes: CaseSheetCellChange[] } {
  const cells: CaseSheetCellMap = new Map();
  const formats: CaseSheetFormatMap = new Map();

  /*
   * Every address the delete touches, each described by where its contents came from. Formatting
   * moves up with its row, so a highlighted row stays highlighted after the row above it goes.
   */
  const touched = new Map<string, { rowIndex: number; colIndex: number; from: string | null }>();
  const remember = (row: number, col: number, from: string | null) => {
    const key = cellKey(row, col);
    const existing = touched.get(key);
    // A cell being moved into wins over the same cell being vacated.
    if (existing?.from && !from) return;
    touched.set(key, { rowIndex: row, colIndex: col, from });
  };

  const addresses = new Set([...grid.cells.keys(), ...grid.formats.keys()]);
  for (const key of addresses) {
    const parsed = parseCellKey(key);
    if (!parsed) continue;

    if (parsed.rowIndex === rowIndex) {
      remember(parsed.rowIndex, parsed.colIndex, null);
      continue;
    }

    if (parsed.rowIndex > rowIndex) {
      const movedTo = cellKey(parsed.rowIndex - 1, parsed.colIndex);
      const value = grid.cells.get(key);
      const format = grid.formats.get(key);
      if (value != null) cells.set(movedTo, value);
      if (format) formats.set(movedTo, format);

      remember(parsed.rowIndex - 1, parsed.colIndex, key);
      // The row the last one vacated has to be cleared, or its old contents linger at the bottom.
      remember(parsed.rowIndex, parsed.colIndex, null);
      continue;
    }

    const value = grid.cells.get(key);
    const format = grid.formats.get(key);
    if (value != null) cells.set(key, value);
    if (format) formats.set(key, format);
  }

  const changes: CaseSheetCellChange[] = [...touched.values()].map((entry) => ({
    rowIndex: entry.rowIndex,
    colIndex: entry.colIndex,
    value: entry.from ? grid.cells.get(entry.from) ?? '' : '',
    format: entry.from ? grid.formats.get(entry.from) ?? null : null,
  }));

  /* A row's colour belongs to the row, so it moves up with everything else below the deleted one. */
  const rowColors: CaseSheetBandMap = new Map();
  for (const [index, color] of grid.rowColors) {
    if (index === rowIndex) continue;
    rowColors.set(index > rowIndex ? index - 1 : index, color);
  }

  /* As does a height someone dragged, or every row below would inherit the wrong one. */
  const rowHeights: CaseSheetSizeMap = new Map();
  for (const [index, height] of grid.rowHeights) {
    if (index === rowIndex) continue;
    rowHeights.set(index > rowIndex ? index - 1 : index, height);
  }

  return {
    grid: {
      ...grid,
      cells,
      formats,
      rowColors,
      rowHeights,
      rowCount: Math.max(0, grid.rowCount - 1),
    },
    changes,
  };
}

/**
 * Splits a clipboard payload into a block of cells.
 *
 * Excel and Google Sheets both put tab-separated columns and newline-separated rows on the
 * clipboard, so pasting a selection from either lands in the right shape instead of one long cell.
 */
export function parsePastedBlock(text: string): string[][] {
  const normalized = String(text ?? '').replace(/\r\n?/g, '\n');
  const withoutTrailingNewline = normalized.replace(/\n+$/, '');
  if (withoutTrailingNewline === '') return [];
  return withoutTrailingNewline.split('\n').map((line) => line.split('\t'));
}

/**
 * Lays a pasted block down with its top-left corner at the given cell.
 *
 * Returns the changes as well as the grid because each one has to be saved and broadcast; a paste is
 * the one edit that can touch hundreds of cells at once.
 */
export function applyPastedBlock(
  grid: CaseSheetGrid,
  anchorRow: number,
  anchorCol: number,
  block: string[][],
): { grid: CaseSheetGrid; changes: CaseSheetCellChange[] } {
  let next = grid;
  const changes: CaseSheetCellChange[] = [];

  block.forEach((row, rowOffset) => {
    row.forEach((raw, colOffset) => {
      const rowIndex = anchorRow + rowOffset;
      const colIndex = anchorCol + colOffset;
      if (rowIndex >= CASE_SHEET_MAX_ROWS || colIndex >= CASE_SHEET_MAX_COLUMNS) return;

      const result = setCell(next, rowIndex, colIndex, raw);
      next = result.grid;
      if (result.changed) {
        // The clipboard gives us plain text, so the destination keeps whatever styling it had.
        changes.push(cellChange(next, rowIndex, colIndex));
      }
    });
  });

  // A paste wider than the sheet grows it, rather than silently dropping the right-hand columns.
  const widest = block.reduce((max, row) => Math.max(max, row.length), 0);
  const neededColumns = Math.min(CASE_SHEET_MAX_COLUMNS, anchorCol + widest);
  while (next.columns.length < neededColumns) {
    next = appendColumn(next);
  }

  return { grid: next, changes };
}

/** Rows and columns actually in use, so export does not pad the file with empty trailing cells. */
export function usedBounds(grid: CaseSheetGrid): { rows: number; cols: number } {
  let rows = 0;
  let cols = 0;
  // Formats count as use: a highlighted empty cell is still a cell someone put there on purpose.
  for (const key of [...grid.cells.keys(), ...grid.formats.keys()]) {
    const parsed = parseCellKey(key);
    if (!parsed) continue;
    rows = Math.max(rows, parsed.rowIndex + 1);
    cols = Math.max(cols, parsed.colIndex + 1);
  }
  return { rows, cols: Math.max(cols, grid.columns.length) };
}

/**
 * Whether any column has been given a name of its own, as opposed to still being called by letter.
 *
 * What makes the difference on the way out: a column called "A" says nothing a spreadsheet does not
 * already show above it, so exporting a row of bare letters would just add a junk line to the file.
 */
export function hasNamedColumns(grid: CaseSheetGrid): boolean {
  return grid.columns.some((label, col) => label !== columnLabel(col));
}

/**
 * The grid as a rectangular array, ready for SheetJS, with the header row first where there is one.
 *
 * Kept separate from the SheetJS call so the shape can be asserted in a test without loading a
 * 1.3 MB library into the test process.
 */
export function gridToAoa(grid: CaseSheetGrid): string[][] {
  const { rows, cols } = usedBounds(grid);
  const header = Array.from({ length: cols }, (_, col) => grid.columns[col] ?? columnLabel(col));
  const body = Array.from({ length: rows }, (_, row) =>
    Array.from({ length: cols }, (_, col) => getCell(grid, row, col)),
  );
  return hasNamedColumns(grid) ? [header, ...body] : body;
}

/**
 * Builds a grid from a sheet read as an array of arrays.
 *
 * The first row becomes the headers, which is what a handler means by uploading a spreadsheet with
 * column titles. A header cell that is blank falls back to its column letter so the column is still
 * addressable.
 */
export function gridFromAoa(
  rows: unknown[][],
  options?: {
    hasHeaderRow?: boolean;
    /**
     * Formatting from the workbook, in the same shape as `rows`.
     *
     * Read out of the file's own XML by `readXlsxCellStyles`, because the spreadsheet libraries
     * hand back only the fill — so this is where an uploaded sheet's text colours, alignment and
     * borders come from.
     */
    styles?: (CaseSheetImportedStyle | null | undefined)[][];
    /** Taken from the workbook where it declares itself right-to-left; otherwise detected. */
    rtl?: boolean;
    /**
     * Hand-set column widths and row heights from the workbook, in pixels and indexed the same way
     * as `rows` — so the header row is index 0 when there is one.
     *
     * Unlike fonts, these the community build does expose, which is why an uploaded sheet keeps the
     * shape its author gave it.
     */
    columnWidths?: (number | null | undefined)[];
    rowHeights?: (number | null | undefined)[];
  },
): CaseSheetGrid {
  const hasHeaderRow = options?.hasHeaderRow !== false;
  const table = (rows ?? []).map((row) => (Array.isArray(row) ? row : []));

  const width = Math.min(
    CASE_SHEET_MAX_COLUMNS,
    Math.max(1, table.reduce((max, row) => Math.max(max, row.length), 0)),
  );

  const headerSource = hasHeaderRow ? table[0] ?? [] : [];
  const columns = Array.from(
    { length: width },
    (_, col) => normalizeCellValue(headerSource[col]) || columnLabel(col),
  );

  const styleTable = options?.styles ?? [];
  const bodyStyles = hasHeaderRow ? styleTable.slice(1) : styleTable;

  const columnWidths: CaseSheetSizeMap = new Map();
  (options?.columnWidths ?? []).slice(0, width).forEach((pixels, col) => {
    if (pixels == null) return;
    const clamped = clampColumnWidth(pixels);
    if (clamped !== CASE_SHEET_COLUMN_WIDTH_DEFAULT) columnWidths.set(col, clamped);
  });

  /* The header's own height belongs to the heading row, which is not part of the grid's rows. */
  const heightSource = options?.rowHeights ?? [];
  const bodyHeights = hasHeaderRow ? heightSource.slice(1) : heightSource;
  const rowHeights: CaseSheetSizeMap = new Map();
  bodyHeights.slice(0, CASE_SHEET_MAX_ROWS).forEach((pixels, row) => {
    if (pixels == null) return;
    const clamped = clampRowHeight(pixels);
    if (clamped !== CASE_SHEET_ROW_HEIGHT_DEFAULT) rowHeights.set(row, clamped);
  });

  const bodyRows = (hasHeaderRow ? table.slice(1) : table).slice(0, CASE_SHEET_MAX_ROWS);
  const cells: CaseSheetCellMap = new Map();
  const formats: CaseSheetFormatMap = new Map();

  bodyRows.forEach((row, rowIndex) => {
    for (let col = 0; col < width; col += 1) {
      const key = cellKey(rowIndex, col);

      const value = normalizeCellValue(row[col]);
      if (value !== '') cells.set(key, value);

      // Formatting on an empty cell is kept: a colour-coded blank is how a spreadsheet marks a gap.
      const format = formatFromImportedStyle(bodyStyles[rowIndex]?.[col]);
      if (format) formats.set(key, format);
    }
  });

  /*
   * The header row's own fills become the column colours, which is what a banded header in the
   * uploaded file actually means.
   */
  const columnColors: CaseSheetBandMap = new Map();
  if (hasHeaderRow) {
    for (let col = 0; col < width; col += 1) {
      const highlight = normalizeHighlight(styleTable[0]?.[col]?.fill);
      if (highlight) columnColors.set(col, highlight);
    }
  }

  return {
    columns,
    // Blank rows to type into, so an imported sheet is not full to the brim.
    rowCount: Math.min(CASE_SHEET_MAX_ROWS, Math.max(bodyRows.length + 5, CASE_SHEET_DEFAULT_ROWS)),
    cells,
    formats,
    // What the workbook says, or failing that what its text looks like.
    rtl: options?.rtl ?? detectRtl(table),
    rowColors: new Map(),
    columnColors,
    rowHeights,
    columnWidths,
  };
}

export type CaseSheetStoredCell = {
  row_index: unknown;
  col_index: unknown;
  value: unknown;
  bold?: unknown;
  italic?: unknown;
  underline?: unknown;
  highlight?: unknown;
  text_color?: unknown;
  font_size?: unknown;
  align?: unknown;
  border_top?: unknown;
  border_right?: unknown;
  border_bottom?: unknown;
  border_left?: unknown;
};

/** Reads the formatting columns off a stored row. */
export function formatFromStoredCell(row: CaseSheetStoredCell): CaseSheetCellFormat | null {
  return normalizeFormat({
    bold: row.bold === true,
    italic: row.italic === true,
    underline: row.underline === true,
    highlight: normalizeHighlight(row.highlight),
    textColor: normalizeHighlight(row.text_color),
    fontSize: normalizeFontSize(row.font_size),
    align: normalizeAlign(row.align),
    borderTop: row.border_top === true,
    borderRight: row.border_right === true,
    borderBottom: row.border_bottom === true,
    borderLeft: row.border_left === true,
  });
}

/** Rebuilds the grid from stored rows. */
export function gridFromStoredCells(
  columns: unknown,
  rowCount: unknown,
  rows: CaseSheetStoredCell[],
  options?: {
    rtl?: unknown;
    rowColors?: unknown;
    columnColors?: unknown;
    rowHeights?: unknown;
    columnWidths?: unknown;
  },
): CaseSheetGrid {
  const headerList = Array.isArray(columns) ? columns : [];
  const parsedColumns = headerList
    .slice(0, CASE_SHEET_MAX_COLUMNS)
    .map((label, col) => normalizeCellValue(label) || columnLabel(col));

  const cells: CaseSheetCellMap = new Map();
  const formats: CaseSheetFormatMap = new Map();
  for (const row of rows ?? []) {
    const rowIndex = Number(row.row_index);
    const colIndex = Number(row.col_index);
    if (!Number.isInteger(rowIndex) || !Number.isInteger(colIndex)) continue;

    const key = cellKey(rowIndex, colIndex);
    const value = normalizeCellValue(row.value);
    if (value !== '') cells.set(key, value);

    // Read even when the text is empty: a highlighted blank cell is deliberate.
    const format = formatFromStoredCell(row);
    if (format) formats.set(key, format);
  }

  const storedRowCount = Number(rowCount);
  const { rows: usedRows, cols: usedCols } = usedBounds({
    columns: parsedColumns,
    rowCount: 0,
    cells,
    formats,
  });

  return {
    // Never fewer rows or columns than there are cells, or stored data would be unreachable.
    columns:
      parsedColumns.length >= usedCols
        ? parsedColumns
        : Array.from({ length: usedCols }, (_, col) => parsedColumns[col] ?? columnLabel(col)),
    rowCount: Math.max(
      usedRows,
      Number.isFinite(storedRowCount) && storedRowCount > 0 ? storedRowCount : CASE_SHEET_DEFAULT_ROWS,
    ),
    cells,
    formats,
    rtl: options?.rtl === true,
    // Re-validated here, so a colour that somehow got stored badly never reaches a style attribute.
    rowColors: bandMapFromRecord(options?.rowColors),
    columnColors: bandMapFromRecord(options?.columnColors),
    rowHeights: sizeMapFromRecord(options?.rowHeights, clampRowHeight),
    columnWidths: sizeMapFromRecord(options?.columnWidths, clampColumnWidth),
  };
}

/**
 * Folds a whole-sheet change arriving from another handler into the local grid.
 *
 * The row count only ever grows: the remote count was right when it was sent, but it does not know
 * about rows added locally since, and shrinking to match would hide cells someone is typing into.
 * The rest is cosmetic, so the remote value simply wins — the same last-write-wins rule the cells
 * themselves follow.
 */
export function applyRemoteShape(
  grid: CaseSheetGrid,
  shape: {
    columns?: string[];
    rowCount?: number;
    rtl?: unknown;
    rowColors?: unknown;
    columnColors?: unknown;
    rowHeights?: unknown;
    columnWidths?: unknown;
  },
): CaseSheetGrid {
  return {
    ...grid,
    columns: shape.columns && shape.columns.length > 0 ? shape.columns : grid.columns,
    rowCount: Math.max(grid.rowCount, Number(shape.rowCount) || 0),
    rtl: shape.rtl === true,
    rowColors: bandMapFromRecord(shape.rowColors),
    columnColors: bandMapFromRecord(shape.columnColors),
    rowHeights: sizeMapFromRecord(shape.rowHeights, clampRowHeight),
    columnWidths: sizeMapFromRecord(shape.columnWidths, clampColumnWidth),
  };
}

/**
 * Folds a remote cell change into the local grid.
 *
 * Separate from setCell because a remote edit must not grow the row count the way local typing does
 * — the sender's own save already recorded the new height, and growing on every inbound cell would
 * make a colleague's paste jump the viewport.
 */
export function applyRemoteCell(
  grid: CaseSheetGrid,
  rowIndex: number,
  colIndex: number,
  rawValue: unknown,
  rawFormat?: CaseSheetCellFormat | null,
): CaseSheetGrid {
  const value = normalizeCellValue(rawValue);
  const format = normalizeFormat(rawFormat);
  const key = cellKey(rowIndex, colIndex);

  const sameValue = (grid.cells.get(key) ?? '') === value;
  const sameFormat =
    JSON.stringify(grid.formats.get(key) ?? {}) === JSON.stringify(format ?? {});
  if (sameValue && sameFormat) return grid;

  const cells = new Map(grid.cells);
  if (value === '') cells.delete(key);
  else cells.set(key, value);

  const formats = new Map(grid.formats);
  if (format) formats.set(key, format);
  else formats.delete(key);

  return { ...grid, cells, formats, rowCount: Math.max(grid.rowCount, rowIndex + 1) };
}

/* ------------------------------------------------------------------ selection geometry */

export type CaseSheetCellRef = { rowIndex: number; colIndex: number };

/**
 * A selected rectangle: `anchor` is where the selection began and `focus` where it was dragged or
 * shift-clicked to. Either corner can be the top-left, so everything here works from the min and max
 * rather than assuming an order.
 */
export type CaseSheetRange = { anchor: CaseSheetCellRef; focus: CaseSheetCellRef };

export function rangeBounds(range: CaseSheetRange): {
  rowFrom: number;
  rowTo: number;
  colFrom: number;
  colTo: number;
} {
  return {
    rowFrom: Math.min(range.anchor.rowIndex, range.focus.rowIndex),
    rowTo: Math.max(range.anchor.rowIndex, range.focus.rowIndex),
    colFrom: Math.min(range.anchor.colIndex, range.focus.colIndex),
    colTo: Math.max(range.anchor.colIndex, range.focus.colIndex),
  };
}

/** Every cell in the rectangle, which is what a formatting change is applied to. */
export function rangeCells(range: CaseSheetRange | null): CaseSheetCellRef[] {
  if (!range) return [];
  const { rowFrom, rowTo, colFrom, colTo } = rangeBounds(range);

  const cells: CaseSheetCellRef[] = [];
  for (let rowIndex = rowFrom; rowIndex <= rowTo; rowIndex += 1) {
    for (let colIndex = colFrom; colIndex <= colTo; colIndex += 1) {
      cells.push({ rowIndex, colIndex });
    }
  }
  return cells;
}

/**
 * The rectangle covering whole rows or whole columns, the way clicking a header does in Excel.
 *
 * `from` and `to` are the first and last header dragged across, in either order.
 */
export function bandRange(
  band: 'row' | 'column',
  from: number,
  to: number,
  grid: CaseSheetGrid,
): CaseSheetRange {
  if (band === 'row') {
    return {
      anchor: { rowIndex: from, colIndex: 0 },
      focus: { rowIndex: to, colIndex: Math.max(0, grid.columns.length - 1) },
    };
  }
  return {
    anchor: { rowIndex: 0, colIndex: from },
    focus: { rowIndex: Math.max(0, grid.rowCount - 1), colIndex: to },
  };
}

/**
 * Whether a row is selected end to end, which is what marks its number in the gutter.
 *
 * Judged from the selection's own shape rather than from a remembered "I clicked a header" flag, so
 * dragging a block that happens to span every column marks the rows too — same as Excel.
 */
export function isRowFullySelected(
  range: CaseSheetRange | null,
  rowIndex: number,
  grid: CaseSheetGrid,
): boolean {
  if (!range) return false;
  const { rowFrom, rowTo, colFrom, colTo } = rangeBounds(range);
  return (
    rowIndex >= rowFrom &&
    rowIndex <= rowTo &&
    colFrom === 0 &&
    colTo >= grid.columns.length - 1
  );
}

export function isColumnFullySelected(
  range: CaseSheetRange | null,
  colIndex: number,
  grid: CaseSheetGrid,
): boolean {
  if (!range) return false;
  const { rowFrom, rowTo, colFrom, colTo } = rangeBounds(range);
  return (
    colIndex >= colFrom && colIndex <= colTo && rowFrom === 0 && rowTo >= grid.rowCount - 1
  );
}

/* ------------------------------------------------------------------ undo history */

/**
 * Undoing works by putting back only what a step actually changed, rather than by swapping in a
 * whole saved copy of the sheet. Two people edit the same sheet at once, and a wholesale restore
 * would quietly revert a colleague's cell along with your own.
 */

/** Every cell that differs between two versions of a sheet, by its text or by its formatting. */
export function changedCellsBetween(
  before: CaseSheetGrid,
  after: CaseSheetGrid,
): CaseSheetCellRef[] {
  const keys = new Set<string>([
    ...before.cells.keys(),
    ...after.cells.keys(),
    ...before.formats.keys(),
    ...after.formats.keys(),
  ]);

  const changed: CaseSheetCellRef[] = [];
  for (const key of keys) {
    const sameValue = (before.cells.get(key) ?? '') === (after.cells.get(key) ?? '');
    const sameFormat =
      JSON.stringify(before.formats.get(key) ?? {}) === JSON.stringify(after.formats.get(key) ?? {});
    if (sameValue && sameFormat) continue;
    const ref = parseCellKey(key);
    if (ref) changed.push(ref);
  }
  return changed;
}

/** Copies those cells across from `source`, leaving every other cell of `target` as it is. */
export function restoreCells(
  target: CaseSheetGrid,
  source: CaseSheetGrid,
  cells: CaseSheetCellRef[],
): CaseSheetGrid {
  if (cells.length === 0) return target;

  const nextCells = new Map(target.cells);
  const nextFormats = new Map(target.formats);

  for (const { rowIndex, colIndex } of cells) {
    const key = cellKey(rowIndex, colIndex);

    const value = source.cells.get(key) ?? '';
    if (value === '') nextCells.delete(key);
    else nextCells.set(key, value);

    const format = source.formats.get(key);
    if (format) nextFormats.set(key, format);
    else nextFormats.delete(key);
  }

  return { ...target, cells: nextCells, formats: nextFormats };
}

function sameMap<K, V>(a: Map<K, V>, b: Map<K, V>): boolean {
  if (a.size !== b.size) return false;
  for (const [key, value] of a) {
    if (b.get(key) !== value) return false;
  }
  return true;
}

/** Whether anything outside the cells changed: the columns, the row count, banding or sizes. */
export function gridShapeChanged(a: CaseSheetGrid, b: CaseSheetGrid): boolean {
  return (
    a.rowCount !== b.rowCount ||
    a.rtl !== b.rtl ||
    a.columns.length !== b.columns.length ||
    a.columns.some((label, index) => label !== b.columns[index]) ||
    !sameMap(a.rowColors, b.rowColors) ||
    !sameMap(a.columnColors, b.columnColors) ||
    !sameMap(a.rowHeights, b.rowHeights) ||
    !sameMap(a.columnWidths, b.columnWidths)
  );
}

export function restoreGridShape(target: CaseSheetGrid, source: CaseSheetGrid): CaseSheetGrid {
  return {
    ...target,
    columns: [...source.columns],
    rowCount: source.rowCount,
    rtl: source.rtl,
    rowColors: new Map(source.rowColors),
    columnColors: new Map(source.columnColors),
    rowHeights: new Map(source.rowHeights),
    columnWidths: new Map(source.columnWidths),
  };
}
