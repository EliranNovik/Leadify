/*
 * Scratch probe: what does `xlsx-js-style` expose on read that plain `xlsx` drops?
 *
 * The question is specifically font colour and horizontal alignment, which the community `xlsx`
 * build does not surface, and whether they survive a write as well as a read.
 */
const XLSXStyle = require('xlsx-js-style');
const XLSX = require('xlsx');

function build(lib) {
  const ws = lib.utils.aoa_to_sheet([
    ['plain', 'red text', 'centred', 'right', 'bordered'],
  ]);
  ws['B1'].s = { font: { color: { rgb: 'FFCC0000' }, bold: true, sz: 16 } };
  ws['C1'].s = { alignment: { horizontal: 'center' } };
  ws['D1'].s = { alignment: { horizontal: 'right' } };
  ws['E1'].s = {
    border: {
      top: { style: 'thin', color: { rgb: 'FF000000' } },
      bottom: { style: 'thin', color: { rgb: 'FF000000' } },
    },
    fill: { patternType: 'solid', fgColor: { rgb: 'FFFFFF00' } },
  };
  const wb = lib.utils.book_new();
  lib.utils.book_append_sheet(wb, ws, 'Probe');
  return lib.write(wb, { type: 'buffer', bookType: 'xlsx' });
}

function report(label, lib, buffer) {
  const wb = lib.read(buffer, { type: 'buffer', cellStyles: true });
  const ws = wb.Sheets[wb.SheetNames[0]];
  console.log(`\n=== read by ${label} ===`);
  for (const ref of ['A1', 'B1', 'C1', 'D1', 'E1']) {
    console.log(`  ${ref} ${ws[ref].v.padEnd(10)} s=${JSON.stringify(ws[ref].s ?? null)}`);
  }
}

const styled = build(XLSXStyle);
report('xlsx-js-style (file written by xlsx-js-style)', XLSXStyle, styled);
report('plain xlsx (same file)', XLSX, styled);
