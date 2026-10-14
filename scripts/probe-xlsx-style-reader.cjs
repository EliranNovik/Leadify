/*
 * Scratch probe: does the hand-written style reader actually read a real workbook?
 *
 * Builds a styled file with xlsx-js-style, unzips it, and runs src/lib/xlsxCellStyles.ts over its
 * XML — the same path the upload handler takes. Bundled with esbuild so the TypeScript module under
 * test is the real one rather than a copy.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const JSZip = require('jszip');
const XLSXStyle = require('xlsx-js-style');

const out = path.join(os.tmpdir(), `xlsx-style-reader-${Date.now()}.cjs`);
execFileSync('npx', [
  'esbuild',
  'src/lib/xlsxCellStyles.ts',
  '--bundle',
  '--platform=node',
  '--format=cjs',
  `--outfile=${out}`,
]);
const { readXlsxCellStyles } = require(out);

function styledWorkbook() {
  const ws = XLSXStyle.utils.aoa_to_sheet([
    ['plain', 'red bold', 'centred', 'right', 'bordered fill', 'big blue underline'],
    ['theme tint', 'italic', '', '', '', ''],
  ]);

  ws.B1.s = { font: { color: { rgb: 'CC0000' }, bold: true } };
  ws.C1.s = { alignment: { horizontal: 'center' } };
  ws.D1.s = { alignment: { horizontal: 'right' } };
  ws.E1.s = {
    border: { top: { style: 'thin' }, bottom: { style: 'medium' } },
    fill: { patternType: 'solid', fgColor: { rgb: 'FFFF00' } },
  };
  ws.F1.s = { font: { color: { rgb: '0000FF' }, sz: 20, underline: true } };
  ws.A2.s = { font: { color: { theme: 4, tint: 0.4 } } };
  ws.B2.s = { font: { italic: true } };

  const wb = XLSXStyle.utils.book_new();
  XLSXStyle.utils.book_append_sheet(wb, ws, 'Probe');
  return XLSXStyle.write(wb, { type: 'buffer', bookType: 'xlsx' });
}

(async () => {
  const zip = await JSZip.loadAsync(styledWorkbook());

  const names = Object.keys(zip.files);
  console.log('parts:', names.filter((n) => /styles|theme|sheet1/.test(n)).join(', '));

  const stylesXml = await zip.file('xl/styles.xml').async('string');
  const sheetXml = await zip.file('xl/worksheets/sheet1.xml').async('string');
  const themeFile = zip.file('xl/theme/theme1.xml');
  const themeXml = themeFile ? await themeFile.async('string') : undefined;

  const styles = readXlsxCellStyles(stylesXml, sheetXml, themeXml);

  const expected = {
    '0:1': 'red + bold',
    '0:2': 'centre',
    '0:3': 'right',
    '0:4': 'yellow fill + top/bottom borders',
    '0:5': 'blue + 20pt + underline',
    '1:0': 'theme colour with tint',
    '1:1': 'italic',
  };

  console.log(`\nread ${styles.size} styled cells`);
  for (const [key, note] of Object.entries(expected)) {
    console.log(`  ${key} (${note}) -> ${JSON.stringify(styles.get(key) ?? null)}`);
  }

  fs.unlinkSync(out);
})();
