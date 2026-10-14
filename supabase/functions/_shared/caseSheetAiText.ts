/**
 * Turns a case's handling sheets into text an AI model can read.
 *
 * Lives in `_shared` so the browser and the edge functions render the sheets identically — the
 * wording below tells the model how to read a handler's shorthand, and two copies of it would
 * drift. Imported by `src/lib/caseSheetAiText.ts` on the app side.
 *
 * The sheets are where a case manager records what has actually been ordered and received —
 * documents, who they belong to, what is still outstanding — and until now none of it reached the
 * AI, so a lead summary or a follow-up email could not mention the very work the case consists of.
 *
 * A grid does not survive being flattened casually: a column of row indices means nothing to a
 * model, and a sheet with twenty blank rows in the middle of it would spend most of a prompt saying
 * nothing. So this renders only the cells that have content, keeps each row on one line with the
 * row number the handler sees, and stays inside a budget.
 *
 * Pure, so the truncation rules can be tested without a database.
 */

export type CaseSheetAiCell = {
  rowIndex: number;
  colIndex: number;
  value: string;
};

export type CaseSheetAiSheet = {
  name: string;
  /** A Hebrew sheet reads right to left, which is worth saying before a table of Hebrew text. */
  rtl?: boolean;
  /** Only used when the handler named the columns; unnamed ones are just A, B, C. */
  columns?: string[];
  cells: CaseSheetAiCell[];
  updatedAt?: string | null;
};

/**
 * Budgets, in a prompt that already carries meetings, emails and call notes.
 *
 * Rows rather than characters as the first limit, so a sheet is cut at a row boundary and the model
 * never sees half a record and takes it for a whole one.
 */
export const CASE_SHEET_AI_MAX_ROWS = 60;
export const CASE_SHEET_AI_MAX_COLUMNS = 24;
export const CASE_SHEET_AI_MAX_CELL_CHARS = 200;
export const CASE_SHEET_AI_MAX_CHARS = 9000;

function cellText(value: unknown): string {
  return String(value ?? '')
    // One line per row, so a stray newline cannot invent a record.
    .replace(/\s+/g, ' ')
    .trim()
    // The separator, which a value is not allowed to forge.
    .replace(/\|/g, '/')
    .slice(0, CASE_SHEET_AI_MAX_CELL_CHARS);
}

/** `A`, `B` … `AA`, the labels an unnamed column carries in the sheet itself. */
function columnLabel(index: number): string {
  let label = '';
  let n = index;
  while (n >= 0) {
    label = String.fromCharCode(65 + (n % 26)) + label;
    n = Math.floor(n / 26) - 1;
  }
  return label;
}

type Rendered = { text: string; rows: number; columns: number; truncatedRows: number };

function renderRows(sheet: CaseSheetAiSheet): Rendered {
  const byRow = new Map<number, Map<number, string>>();
  let widest = 0;

  for (const cell of sheet.cells ?? []) {
    const rowIndex = Number(cell?.rowIndex);
    const colIndex = Number(cell?.colIndex);
    if (!Number.isInteger(rowIndex) || !Number.isInteger(colIndex)) continue;
    if (colIndex >= CASE_SHEET_AI_MAX_COLUMNS) continue;

    const text = cellText(cell?.value);
    if (!text) continue;

    const row = byRow.get(rowIndex) ?? new Map<number, string>();
    row.set(colIndex, text);
    byRow.set(rowIndex, row);
    widest = Math.max(widest, colIndex + 1);
  }

  /*
   * Only rows with something in them, in sheet order. A handler's sheet is mostly empty space
   * waiting to be filled, and the gaps carry no meaning worth a line of prompt each.
   */
  const rowIndexes = [...byRow.keys()].sort((a, b) => a - b);
  const kept = rowIndexes.slice(0, CASE_SHEET_AI_MAX_ROWS);

  const lines = kept.map((rowIndex) => {
    const row = byRow.get(rowIndex) as Map<number, string>;
    const cells = Array.from({ length: widest }, (_, col) => row.get(col) ?? '');
    // The number the handler sees in the gutter, so a reply can say "row 7" and mean it.
    return `row ${rowIndex + 1} | ${cells.join(' | ')}`;
  });

  return {
    text: lines.join('\n'),
    rows: rowIndexes.length,
    columns: widest,
    truncatedRows: rowIndexes.length - kept.length,
  };
}

/** Whether the handler named the columns, or they are still the sheet's own letters. */
function namedColumns(sheet: CaseSheetAiSheet, columns: number): string[] | null {
  const labels = (sheet.columns ?? []).slice(0, Math.max(columns, 0)).map((label) => cellText(label));
  if (labels.length === 0) return null;
  return labels.some((label, index) => label && label !== columnLabel(index)) ? labels : null;
}

function renderSheet(sheet: CaseSheetAiSheet): string {
  const body = renderRows(sheet);

  const heading = [
    `TAB "${cellText(sheet.name) || 'Sheet'}"`,
    body.rows > 0 ? `${body.rows} rows with content` : 'empty',
    sheet.rtl ? 'right-to-left (Hebrew)' : '',
    sheet.updatedAt ? `last changed ${String(sheet.updatedAt).slice(0, 10)}` : '',
  ]
    .filter(Boolean)
    .join(' — ');

  if (body.rows === 0) return `${heading}\n(nothing filled in yet)`;

  const labels = namedColumns(sheet, body.columns);
  const parts = [heading];
  if (labels) parts.push(`columns | ${labels.join(' | ')}`);
  parts.push(body.text);
  if (body.truncatedRows > 0) {
    parts.push(`(… ${body.truncatedRows} further rows not shown)`);
  }

  return parts.join('\n');
}

/**
 * How to read a handler's sheet, in the model's own context.
 *
 * These sheets are shorthand, not a schema: a tick in a cell is the whole status, and an empty cell
 * means a document has not arrived — not that it was never needed. Without being told that, a model
 * reads the grid literally and reports a case as having no documents at all.
 */
/**
 * The opening words of the block, so a caller can tell whether a case file already carries it.
 *
 * The app appends the sheets to whatever the `ai-lead-followup` function returned, and that
 * function now includes them itself — this is how the app avoids sending both copies, and it keeps
 * working either side of that function being deployed.
 */
export const CASE_SHEET_AI_MARKER = 'CASE HANDLING SHEETS';

export const CASE_SHEET_AI_LEGEND = [
  `${CASE_SHEET_AI_MARKER} — the case manager's own spreadsheet tabs for this case, kept by hand in Hebrew and English.`,
  'HOW TO READ THEM: mostly one row per document per contact — which document was ordered for which person, when it was ordered, and whether it has come back. A tab often lists the family members or applicants down one side and the documents across the other.',
  'A "V" in a cell means YES — that document was received, or that step is done. Treat V, v, ✓, ✔ and וי as the same yes. An empty cell means it has NOT been done yet, not that it does not apply.',
  'Dates are written as the case manager typed them, usually day/month/year, and usually the date the document was ordered or requested. Do not reformat them and do not infer a year that is not written.',
  'This is the record of what has actually been done on the case, so use it for what is still outstanding and what the next step is. Where a row or cell is unclear, say that it is unclear rather than guessing what it means, and never invent a row, a date or a status.',
].join(' ');

/**
 * Every tab of a case, as one block of text, legend first.
 *
 * Returns an empty string when the case has no sheets, so a caller can leave the whole section out
 * rather than telling the model about something that does not exist.
 */
export function renderCaseSheetsForAi(sheets: CaseSheetAiSheet[]): string {
  if (!Array.isArray(sheets) || sheets.length === 0) return '';

  const blocks: string[] = [CASE_SHEET_AI_LEGEND];
  let used = 0;
  let dropped = 0;

  for (const sheet of sheets) {
    const block = renderSheet(sheet);

    /*
     * The budget is checked before adding rather than trimmed after, so what the model reads is
     * always a whole tab — a tab cut off halfway reads like a tab that ends there.
     */
    if (used + block.length > CASE_SHEET_AI_MAX_CHARS && used > 0) {
      dropped += 1;
      continue;
    }

    blocks.push(block);
    used += block.length;
  }

  if (dropped > 0) {
    blocks.push(`(… ${dropped} further tabs not shown; open the Case Handling tab to read them)`);
  }

  return blocks.join('\n\n');
}
