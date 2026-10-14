/**
 * Scratch harness: renders the Case Handling markup against the real compiled CSS and screenshots
 * it, so the layout can be reviewed without a Supabase connection behind the tab.
 *
 * Run with: CHROME_PATH="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" \
 *   node scripts/preview-case-handling.cjs
 */
const fs = require('fs');
const path = require('path');
const puppeteer = require('puppeteer');

const root = path.resolve(__dirname, '..');

function compiledCss() {
  const dir = path.join(root, 'dist', 'assets');
  const file = fs.readdirSync(dir).find((f) => /^index-.*\.css$/.test(f));
  if (!file) throw new Error('Build first: npm run build');
  return fs.readFileSync(path.join(dir, file), 'utf8');
}

/** A Hebrew sheet, to show the right-to-left layout and the per-cell direction. */
const RTL = process.env.PREVIEW_RTL === '1';
const COLUMNS = ['Applicant', 'Document', 'Date', 'Received', 'Notes', 'F'];
const LETTERS = ['A', 'B', 'C', 'D', 'E', 'F'];

/** The strip of sheet tabs, as a workbook's tabs arrive from an upload. */
const TABS = ['Applicants', 'Documents', 'תעודות', 'Sheet 4'];
const ACTIVE_TAB = 0;

const ROWS = [
  ['Tamar Ben David', 'Birth certificate', '2026-09-02', 'Yes', 'original on file', ''],
  ['Tamar Ben David', 'תעודת נישואין', '2026-09-02', 'Waiting', 'nudged by email', ''],
  ['Daniel Levi', 'Passport scan', '2026-09-14', 'Yes', '', ''],
  ['Daniel Levi', 'Police clearance', '2026-09-14', 'No', '', ''],
  ['', '', '', '', '', ''],
  ['', '', '', '', '', ''],
  ['', '', '', '', '', ''],
  ['', '', '', '', '', ''],
  ['', '', '', '', '', ''],
  ['', '', '', '', '', ''],
  ['', '', '', '', '', ''],
  ['', '', '', '', '', ''],
  ['', '', '', '', '', ''],
  ['', '', '', '', '', ''],
];

const FORMATS = {
  '1:3': { bold: true, highlight: '#fef08a' },
  '3:3': { bold: true, highlight: '#fbcfe8', textColor: '#dc2626' },
  /* Text colours, including on a cell that also carries a fill. */
  '0:4': { textColor: '#15803d' },
  '1:4': { textColor: '#ea580c', italic: true },
  '2:1': { textColor: '#1d4ed8', bold: true },
};

/** A painted row and a painted column, to show the precedence between them and a cell. */
const ROW_COLORS = { 0: '#bbf7d0' };
const COLUMN_COLORS = { 0: '#bfdbfe', 1: '#bfdbfe', 2: '#bfdbfe', 3: '#bfdbfe', 4: '#bfdbfe' };

/** Two whole rows picked by dragging down the row numbers, as in Excel. */
const RANGE = { rowFrom: 2, rowTo: 3, colFrom: 0, colTo: 5 };
/** A row is marked in the gutter only when the selection spans every column. */
const rowSelected = (rowIndex) =>
  rowIndex >= RANGE.rowFrom &&
  rowIndex <= RANGE.rowTo &&
  RANGE.colFrom === 0 &&
  RANGE.colTo >= COLUMNS.length - 1;
/** The cell being edited — the input floats over the text, so the row height never moves. */
const SELECTED = { row: -1, col: -1 };
/** The row under the pointer, showing the delete control beside its number. */
const HOVERED = 4;

/** Two cells centred, so the alignment override is visible against its right-to-left neighbours. */
const ALIGNED = { '2:2': 'center', '3:2': 'center' };

/** An outlined block of four, the way "Outside" draws it. */
const CELL_BORDER = '1.5px solid #374151';
const LINES = {};
for (let row = 0; row <= 4; row += 1) {
  for (let col = 0; col <= 2; col += 1) {
    LINES[`${row}:${col}`] = ['Top', 'Right', 'Bottom', 'Left'];
  }
}

/** One column dragged wider and one row dragged taller, to show both handles in use. */
const COLUMN_WIDTHS = { 1: 240 };
const ROW_HEIGHTS = { 3: 64 };

const widthOf = (colIndex) => COLUMN_WIDTHS[colIndex] ?? 160;
const heightOf = (rowIndex) => ROW_HEIGHTS[rowIndex] ?? 36;
const TOTAL_WIDTH = 56 + COLUMNS.reduce((total, _, i) => total + widthOf(i), 0);

function styleFor(rowIndex, colIndex) {
  const format = FORMATS[`${rowIndex}:${colIndex}`];
  if (!format) return '';
  const parts = [];
  if (format.bold) parts.push('font-weight:700');
  if (format.italic) parts.push('font-style:italic');
  if (format.underline) parts.push('text-decoration:underline');
  if (format.highlight) parts.push(`background-color:${format.highlight}`);
  if (format.textColor) parts.push(`color:${format.textColor}`);
  if (format.fontSize) parts.push(`font-size:${format.fontSize}px`);
  return parts.join(';');
}

/** Narrowest wins: the cell's own colour, then its row's, then its column's. */
function background(rowIndex, colIndex) {
  const format = FORMATS[`${rowIndex}:${colIndex}`];
  return format?.highlight || ROW_COLORS[rowIndex] || COLUMN_COLORS[colIndex] || null;
}

function cell(rowIndex, colIndex, value) {
  const isSelected = SELECTED.row === rowIndex && SELECTED.col === colIndex;
  const inRange =
    rowIndex >= RANGE.rowFrom &&
    rowIndex <= RANGE.rowTo &&
    colIndex >= RANGE.colFrom &&
    colIndex <= RANGE.colTo;

  const fill = background(rowIndex, colIndex);
  const align = ALIGNED[`${rowIndex}:${colIndex}`];
  const lines = (LINES[`${rowIndex}:${colIndex}`] ?? [])
    .map((edge) => `border-${edge.toLowerCase()}:${CELL_BORDER}`)
    .join(';');
  const style = [
    styleFor(rowIndex, colIndex),
    fill ? `background-color:${fill}` : '',
    align ? `text-align:${align}` : '',
  ]
    .filter(Boolean)
    .join(';');

  const edge = colIndex === 0 ? ' border-l' : '';
  const tint = fill ? '' : ' bg-white';

  const height = heightOf(rowIndex);
  const text = `<div class="truncate px-3 cursor-cell ${
    value ? 'text-gray-900' : 'text-gray-300'
  }" style="${style};height:${height}px;line-height:${height}px" dir="auto">${value}</div>`;

  /* The selection is a layer, so it stays visible over a painted cell's inline fill. */
  const overlay = inRange
    ? '<span class="pointer-events-none absolute inset-0 bg-primary/20"></span>'
    : '';

  const input = isSelected
    ? `<input value="" class="absolute inset-0 h-full w-full border-0 bg-white px-3 leading-9 outline-none ring-2 ring-primary ring-inset" style="${style}" />`
    : '';

  return `<td class="relative border-b border-r border-gray-200 p-0 align-middle${edge}${tint}" style="${lines}">${text}${overlay}${input}</td>`;
}

function gutter(rowIndex) {
  const trash =
    rowIndex === HOVERED
      ? `<button class="block text-gray-400"><svg class="w-5 h-5" fill="none" stroke="currentColor" stroke-width="1.5" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="m14.74 9-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 0 1-2.244 2.077H8.084a2.25 2.25 0 0 1-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 0 0-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 0 1 3.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 0 0-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 0 0-7.5 0"/></svg></button>`
      : '';

  const fill = ROW_COLORS[rowIndex];
  const selected = rowSelected(rowIndex);
  const tone = selected ? ' text-primary font-semibold' : ' text-gray-400';
  const background = fill ? '' : selected ? ' bg-primary/20' : ' bg-gray-100';

  return `<td class="sticky start-0 z-10 px-0 align-middle text-[11px]${tone}${background}" style="${
    fill ? `background-color:${fill}` : ''
  }"><div class="flex items-center justify-end gap-1 px-1.5 cursor-pointer" style="height:${heightOf(
    rowIndex,
  )}px">${trash}<span>${
    rowIndex + 1
  }</span></div><span class="absolute bottom-0 start-0 z-10 h-1.5 w-full cursor-row-resize ${
    rowIndex === 3 ? 'bg-primary/40' : ''
  }"></span></td>`;
}

const html = `<!doctype html>
<html data-theme="light"><head><meta charset="utf-8"><style>${compiledCss()}</style>
<style>html,body{height:100%;margin:0}body{background:#f3f4f6;padding:24px;box-sizing:border-box;font-family:Inter,system-ui,sans-serif}</style></head>
<body>
<div class="flex flex-col gap-3" style="height:100%">
  <div class="flex flex-wrap items-center gap-3 px-1">
    <div class="flex items-center gap-2 font-semibold text-gray-900">
      <svg class="w-5 h-5 text-primary" fill="none" stroke="currentColor" stroke-width="1.5" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M3.375 19.5h17.25m-17.25 0a1.125 1.125 0 0 1-1.125-1.125M3.375 19.5h7.5c.621 0 1.125-.504 1.125-1.125m-9.75 0V5.625m0 12.75v-1.5c0-.621.504-1.125 1.125-1.125m18.375 2.625V5.625m0 12.75c0 .621-.504 1.125-1.125 1.125m1.125-1.125v-1.5c0-.621-.504-1.125-1.125-1.125M3.375 4.5h17.25c.621 0 1.125.504 1.125 1.125M12 10.875h9.375M12 10.875c0 .621-.504 1.125-1.125 1.125M12 10.875V5.625m0 5.25v5.25m0-10.5c0-.621-.504-1.125-1.125-1.125"/></svg>
      Case Handling
    </div>
    <div class="ml-auto flex flex-wrap items-center gap-2">
      <button class="btn btn-sm btn-ghost gap-1">+ 20 rows</button>
      <button class="btn btn-sm btn-ghost gap-1">+ Column</button>
      <button class="btn btn-sm btn-ghost gap-1">RTL</button>
    <button class="btn btn-sm btn-ghost gap-1"><svg class="w-4 h-4" fill="none" stroke="currentColor" stroke-width="1.5" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M9 9V4.5M9 9H4.5M9 9 3.75 3.75M9 15v4.5M9 15H4.5M9 15l-5.25 5.25M15 9h4.5M15 9V4.5M15 9l5.25-5.25M15 15h4.5M15 15v4.5m0-4.5 5.25 5.25"/></svg>Exit</button>
      <button class="btn btn-sm btn-outline gap-1"><svg class="w-4 h-4" fill="none" stroke="currentColor" stroke-width="1.5" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M7.217 10.907a2.25 2.25 0 1 0 0 2.186m0-2.186c.18.324.283.696.283 1.093s-.103.77-.283 1.093m0-2.186 9.566-5.314m-9.566 7.5 9.566 5.314m0 0a2.25 2.25 0 1 0 3.935 2.186 2.25 2.25 0 0 0-3.935-2.186Zm0-12.814a2.25 2.25 0 1 0 3.933-2.185 2.25 2.25 0 0 0-3.933 2.185Z"/></svg>Share</button>
    </div>
  </div>

  <div class="flex flex-wrap items-center gap-1 rounded-xl border border-gray-200 bg-gray-50 px-2 py-1.5">
    <button class="btn btn-xs btn-ghost font-serif font-bold">B</button>
    <button class="btn btn-xs btn-ghost font-serif italic">I</button>
    <button class="btn btn-xs btn-ghost font-serif underline">U</button>
    <span class="mx-1 h-5 w-px bg-gray-300"></span>
    <div class="relative">
      <button class="btn btn-xs btn-ghost gap-1">
        <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" stroke-width="1.5" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M9.53 16.122a3 3 0 0 0-5.78 1.128 2.25 2.25 0 0 1-2.4 2.245 4.5 4.5 0 0 0 8.4-2.245c0-.399-.078-.78-.22-1.128Zm0 0a15.998 15.998 0 0 0 3.388-1.62m-5.043-.025a15.994 15.994 0 0 1 1.622-3.395m3.42 3.42a15.995 15.995 0 0 0 4.764-4.648l3.876-5.814a1.151 1.151 0 0 0-1.597-1.597L14.146 6.32a15.996 15.996 0 0 0-4.649 4.763m3.42 3.42a6.776 6.776 0 0 0-3.42-3.42"/></svg>
        <span class="h-3 w-3 rounded border border-gray-300" style="background-color:#ffffff"></span>
    </button>
    <button class="btn btn-xs btn-ghost gap-1">
      <span class="flex flex-col items-center leading-none">
        <span class="font-serif text-[11px] font-bold">A</span>
        <span class="mt-0.5 h-1 w-3.5 rounded-sm" style="background-color:#dc2626"></span>
      </span>
      </button>
    </div>
    <button class="btn btn-xs btn-ghost gap-1">Row</button>
    <button class="btn btn-xs btn-ghost gap-1">Column</button>
    <span class="mx-1 h-5 w-px bg-gray-300"></span>
    <button class="btn btn-xs btn-ghost gap-1"><svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" stroke-width="1.5" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M3.375 19.5h17.25m-17.25 0a1.125 1.125 0 0 1-1.125-1.125M3.375 19.5h7.5c.621 0 1.125-.504 1.125-1.125m-9.75 0V5.625m0 12.75v-1.5c0-.621.504-1.125 1.125-1.125m18.375 2.625V5.625m0 12.75c0 .621-.504 1.125-1.125 1.125m1.125-1.125v-1.5c0-.621-.504-1.125-1.125-1.125M3.375 4.5h17.25c.621 0 1.125.504 1.125 1.125M12 10.875h9.375M12 10.875c0 .621-.504 1.125-1.125 1.125M12 10.875V5.625m0 5.25v5.25m0-10.5c0-.621-.504-1.125-1.125-1.125"/></svg>Lines</button>
    <span class="mx-1 h-5 w-px bg-gray-300"></span>
    <button class="btn btn-xs btn-ghost"><svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" stroke-width="1.5" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M3.75 6.75h16.5M3.75 12h16.5m-16.5 5.25H12"/></svg></button>
    <button class="btn btn-xs btn-primary"><svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" stroke-width="1.5" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M3.75 6.75h16.5M3.75 12h16.5m-16.5 5.25h16.5"/></svg></button>
    <button class="btn btn-xs btn-ghost"><svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" stroke-width="1.5" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M3.75 6.75h16.5M3.75 12h16.5m-16.5 5.25h8.25"/></svg></button>
    <span class="mx-1 h-5 w-px bg-gray-300"></span>
    <select class="select select-xs select-bordered w-28"><option>14 (normal)</option></select>
    <span class="ml-2 text-xs text-gray-400">Formatting 12 cells</span>
  </div>

  <div class="overflow-hidden rounded-xl bg-white min-h-0 flex-1">
   <div class="h-full overflow-auto" style="margin-inline-end:-15px;padding-inline-end:15px" dir="${RTL ? 'rtl' : 'ltr'}">
    <table class="w-full table-fixed border-collapse text-sm" style="min-width:${TOTAL_WIDTH}px">
      <colgroup><col style="width:56px">${COLUMNS.map(
        (_, i) => `<col style="width:${widthOf(i)}px">`,
      ).join('')}<col></colgroup>
      <thead class="sticky top-0 z-20"><tr>
        <th class="sticky start-0 z-30 bg-gray-100 px-0 py-2"></th>
        ${COLUMNS.map(
          (label, i) =>
            `<th class="relative border-b border-r border-t border-gray-200 px-3 py-2 text-left text-xs font-semibold text-gray-700${
              i === 0 ? ' border-l' : ''
            }${COLUMN_COLORS[i] ? '' : ' bg-gray-50'}" style="${
              COLUMN_COLORS[i] ? `background-color:${COLUMN_COLORS[i]}` : ''
            }" dir="auto"><span class="flex items-baseline gap-1">${label}${
              label !== LETTERS[i]
                ? `<span class="text-[10px] font-normal text-gray-400">${LETTERS[i]}</span>`
                : ''
            }</span><span class="absolute end-0 top-0 z-10 h-full w-1.5 cursor-col-resize ${
              i === 1 ? 'bg-primary/40' : ''
            }"></span></th>`,
        ).join('')}
        <th class="border-b border-t border-gray-200 bg-gray-50 p-0"></th>
      </tr></thead>
      <tbody>
        ${ROWS.map(
          (row, rowIndex) => `<tr class="group">
          ${gutter(rowIndex)}
          ${row.map((value, colIndex) => cell(rowIndex, colIndex, value)).join('')}
          <td class="border-b border-gray-200 p-0"></td>
        </tr>`,
        ).join('')}
      </tbody>
    </table>
   </div>
  </div>

  <div class="flex items-center gap-2 border-t border-gray-200 px-1 pt-2">
    <div class="flex min-w-0 flex-1 items-center gap-1 overflow-x-auto pb-0.5">
      ${TABS.map(
        (tab, i) => `<div class="group flex shrink-0 items-center gap-1 rounded-b-lg border-t-2 px-3 py-1.5 text-xs ${
          i === ACTIVE_TAB
            ? 'border-primary bg-white font-semibold text-gray-900 shadow-sm'
            : 'border-transparent bg-gray-100 text-gray-500'
        }"><button class="max-w-[12rem] truncate">${tab}</button>${
          i === ACTIVE_TAB
            ? '<button class="rounded p-0.5 text-gray-400"><svg class="w-3 h-3" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M6 18 18 6M6 6l12 12"/></svg></button>'
            : ''
        }</div>`,
      ).join('')}
    </div>
    <button class="btn btn-xs btn-ghost shrink-0 gap-1">
      <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" stroke-width="1.5" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M12 4.5v15m7.5-7.5h-15"/></svg>
      Sheet
    </button>
  </div>

  <span class="flex items-center gap-1.5 px-1 text-xs text-gray-500">
    <span class="flex h-6 w-6 items-center justify-center rounded-full bg-gray-200 text-[10px] font-bold text-gray-600">EN</span>
    <span>Last edited by Eliran Novik<span class="text-gray-400"> &middot; 14:21</span></span>
  </span>

</div>
</body></html>`;

(async () => {
  const browser = await puppeteer.launch({
    executablePath: process.env.CHROME_PATH || undefined,
    args: ['--no-sandbox'],
  });
  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 820, deviceScaleFactor: 2 });
  await page.setContent(html, { waitUntil: 'load' });
  const out = path.join(root, 'case-handling-preview.png');
  await page.screenshot({ path: out });
  await browser.close();
  console.log('wrote', out);
})();
