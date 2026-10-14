/*
 * Scratch probe: a sheet exported by the Case Handling tab, read back by the Case Handling tab.
 *
 * The two risky links are at the ends — whether `xlsx-js-style` writes the styles the export asks
 * for, and whether the hand-written reader finds them again. The style objects below are the same
 * shapes `exportCellStyle` builds, so a mismatch here is a mismatch in the app.
 */
const os = require('os');
const path = require('path');
const fs = require('fs');
const { execFileSync } = require('child_process');
const JSZip = require('jszip');
const XLSXStyle = require('xlsx-js-style');

const out = path.join(os.tmpdir(), `case-sheet-roundtrip-${Date.now()}.cjs`);
execFileSync('npx', [
  'esbuild',
  'src/lib/xlsxCellStyles.ts',
  '--bundle',
  '--platform=node',
  '--format=cjs',
  `--outfile=${out}`,
]);
const { readXlsxCellStyles, sheetPartPaths } = require(out);

/** What the tab exports: text, a style per formatted cell, column widths, row heights, direction. */
function exported() {
  const ws = XLSXStyle.utils.aoa_to_sheet([
    ['Applicant', 'Document', 'Received'],
    ['Tamar Ben David', 'Birth certificate', 'Yes'],
    ['תעודת נישואין', '', 'Waiting'],
  ]);

  ws.A1.s = { font: { bold: true, color: { rgb: '1D4ED8' } }, alignment: { horizontal: 'center' } };
  ws.B2.s = {
    font: { color: { rgb: 'DC2626' }, sz: 18 },
    fill: { patternType: 'solid', fgColor: { rgb: 'FEF08A' } },
    border: { top: { style: 'thin' }, bottom: { style: 'thin' } },
  };
  ws.C3.s = { alignment: { horizontal: 'right' }, font: { italic: true, underline: true } };

  ws['!cols'] = [{ wpx: 240 }, { wpx: 160 }, { wpx: 120 }];
  ws['!rows'] = [{ hpx: 36 }, { hpx: 64 }, { hpx: 36 }];

  const wb = XLSXStyle.utils.book_new();
  XLSXStyle.utils.book_append_sheet(wb, ws, 'Case Handling');
  wb.Workbook = { Views: [{ RTL: true }] };

  return XLSXStyle.write(wb, { type: 'buffer', bookType: 'xlsx' });
}

(async () => {
  const buffer = exported();
  const zip = await JSZip.loadAsync(buffer);
  const read = async (p) => (zip.file(p) ? zip.file(p).async('string') : undefined);

  const paths = sheetPartPaths(
    (await read('xl/workbook.xml')) ?? '',
    (await read('xl/_rels/workbook.xml.rels')) ?? '',
  );
  console.log('first sheet part:', paths[0]);

  const styles = readXlsxCellStyles(
    await read('xl/styles.xml'),
    await read(paths[0]),
    await read('xl/theme/theme1.xml'),
  );

  const expected = [
    ['0:0', 'A1 bold blue centred'],
    ['1:1', 'B2 red 18pt yellow fill, top and bottom lines'],
    ['2:2', 'C3 right, italic underline'],
  ];
  console.log('\nformatting that survived the round trip:');
  for (const [key, note] of expected) {
    console.log(`  ${note}\n    ${JSON.stringify(styles.get(key) ?? null)}`);
  }

  // Sizes and direction come back through the ordinary reader rather than the style one.
  const reread = XLSXStyle.read(buffer, { type: 'buffer', cellStyles: true });
  const ws = reread.Sheets[reread.SheetNames[0]];
  console.log('\nwidths:', JSON.stringify((ws['!cols'] ?? []).map((c) => c && c.wpx)));
  console.log('heights:', JSON.stringify((ws['!rows'] ?? []).map((r) => r && r.hpx)));
  console.log('right-to-left:', reread.Workbook?.Views?.[0]?.RTL);
  console.log('a Hebrew value:', JSON.stringify(ws.A3 && ws.A3.v));

  fs.unlinkSync(out);
})();
