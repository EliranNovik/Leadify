import test from 'node:test';
import assert from 'node:assert/strict';

import {
  decodeCellRef,
  parseXlsxStyleTable,
  readXlsxCellStyles,
  sheetPartPaths,
} from './xlsxCellStyles';

/*
 * The XML here is shaped the way Excel itself writes it, not the way the app's own writer does:
 * `xlsx-js-style` has quirks of its own (it puts a colour's tint in a separate element, which no
 * reader would look for), so testing against its output would only prove the two agree with each
 * other. Real files are what the handler uploads.
 */

const THEME = `<?xml version="1.0"?>
<a:theme xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">
  <a:themeElements>
    <a:clrScheme name="Office">
      <a:dk1><a:sysClr val="windowText" lastClr="000000"/></a:dk1>
      <a:lt1><a:sysClr val="window" lastClr="FFFFFF"/></a:lt1>
      <a:dk2><a:srgbClr val="1F497D"/></a:dk2>
      <a:lt2><a:srgbClr val="EEECE1"/></a:lt2>
      <a:accent1><a:srgbClr val="4F81BD"/></a:accent1>
      <a:accent2><a:srgbClr val="C0504D"/></a:accent2>
    </a:clrScheme>
  </a:themeElements>
</a:theme>`;

const STYLES = `<?xml version="1.0"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <fonts count="7">
    <font><sz val="11"/><color theme="1"/><name val="Calibri"/></font>
    <font><b/><sz val="11"/><color rgb="FFCC0000"/><name val="Calibri"/></font>
    <font><i/><u/><sz val="20"/><name val="Calibri"/></font>
    <font><b val="0"/><sz val="11"/><color auto="1"/><name val="Calibri"/></font>
    <font><sz val="11"/><color theme="4" tint="0.39997558519241921"/><name val="Calibri"/></font>
    <font><sz val="11"/><color indexed="10"/><name val="Calibri"/></font>
    <font><u val="none"/><sz val="11"/><name val="Calibri"/></font>
  </fonts>
  <fills count="4">
    <fill><patternFill patternType="none"/></fill>
    <fill><patternFill patternType="gray125"/></fill>
    <fill><patternFill patternType="solid"><fgColor rgb="FFFFFF00"/><bgColor indexed="64"/></patternFill></fill>
    <fill><patternFill patternType="solid"><bgColor rgb="FF92D050"/></patternFill></fill>
  </fills>
  <borders count="3">
    <border><left/><right/><top/><bottom/><diagonal/></border>
    <border><left style="thin"><color indexed="64"/></left><right style="thin"><color indexed="64"/></right><top style="thin"><color indexed="64"/></top><bottom style="thin"><color indexed="64"/></bottom></border>
    <border><left/><right/><top style="none"/><bottom style="medium"><color rgb="FF000000"/></bottom></border>
  </borders>
  <cellXfs count="9">
    <xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>
    <xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/>
    <xf numFmtId="0" fontId="2" fillId="0" borderId="0" xfId="0" applyFont="1"/>
    <xf numFmtId="0" fontId="0" fillId="2" borderId="1" xfId="0" applyFill="1" applyBorder="1"/>
    <xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf>
    <xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0" applyAlignment="1"><alignment horizontal="right"/></xf>
    <xf numFmtId="0" fontId="4" fillId="3" borderId="2" xfId="0"/>
    <xf numFmtId="0" fontId="5" fillId="1" borderId="0" xfId="0"/>
    <xf numFmtId="0" fontId="3" fillId="0" borderId="0" xfId="0" applyAlignment="1"><alignment horizontal="general"/></xf>
  </cellXfs>
</styleSheet>`;

const SHEET = `<?xml version="1.0"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <dimension ref="A1:F4"/>
  <cols><col min="1" max="1" width="18.5" customWidth="1"/></cols>
  <sheetData>
    <row r="1" spans="1:6">
      <c r="A1" t="inlineStr"><is><t>plain</t></is></c>
      <c r="B1" s="1" t="inlineStr"><is><t>red bold</t></is></c>
      <c r="C1" s="2" t="inlineStr"><is><t>big italic underline</t></is></c>
      <c r="D1" s="3"/>
      <c r="E1" s="4" t="inlineStr"><is><t>centred</t></is></c>
      <c r="F1" s="5" t="inlineStr"><is><t>right</t></is></c>
    </row>
    <row r="2" spans="1:6">
      <c r="A2" s="6" t="inlineStr"><is><t>theme tint</t></is></c>
      <c r="B2" s="7" t="inlineStr"><is><t>indexed red</t></is></c>
      <c r="C2" s="8" t="inlineStr"><is><t>switched off</t></is></c>
    </row>
    <row r="3" spans="1:6" s="1" customFormat="1">
      <c r="A3" t="inlineStr"><is><t>inherits the row</t></is></c>
      <c r="B3" s="5" t="inlineStr"><is><t>own wins</t></is></c>
    </row>
  </sheetData>
</worksheet>`;

const styleOf = (ref: string) => {
  const position = decodeCellRef(ref);
  assert.ok(position);
  return readXlsxCellStyles(STYLES, SHEET, THEME).get(
    `${position.rowIndex}:${position.colIndex}`,
  );
};

// ---------------------------------------------------------------- references

test('a cell reference becomes a row and a column', () => {
  assert.deepEqual(decodeCellRef('A1'), { rowIndex: 0, colIndex: 0 });
  assert.deepEqual(decodeCellRef('B7'), { rowIndex: 6, colIndex: 1 });
  // Past the alphabet, where column letters start doubling up.
  assert.deepEqual(decodeCellRef('AA1'), { rowIndex: 0, colIndex: 26 });
  assert.deepEqual(decodeCellRef('ZZ100'), { rowIndex: 99, colIndex: 701 });
  assert.equal(decodeCellRef('A0'), null, 'rows are numbered from one');
  assert.equal(decodeCellRef('1A'), null);
  assert.equal(decodeCellRef(''), null);
});

// ---------------------------------------------------------------- fonts

test('a font colour given as rgb is read, with its alpha channel dropped', () => {
  assert.equal(styleOf('B1')?.fontColor, '#cc0000');
  assert.equal(styleOf('B1')?.bold, true);
});

test('a theme colour is resolved through the theme, and its tint applied', () => {
  /*
   * theme="4" is accent1 — the scheme lists the light and dark pairs in the opposite order to the
   * one the index uses, so getting this wrong returns white instead of blue.
   */
  const color = styleOf('A2')?.fontColor;
  assert.ok(color, 'the theme colour resolved');
  assert.notEqual(color, '#4f81bd', 'a 40% tint is lighter than the base accent');
  assert.equal(color, '#95b3d7');
});

test('an indexed colour comes from the legacy palette', () => {
  assert.equal(styleOf('B2')?.fontColor, '#ff0000');
});

test('"automatic" is not a colour', () => {
  // It means "whatever the program's default is", so stamping black on the cell would be wrong.
  assert.equal(styleOf('C2')?.fontColor, undefined);
});

test('a property switched off is not read as switched on', () => {
  // `<b val="0"/>` and `<u val="none"/>` both spell out the absence of the thing.
  assert.equal(styleOf('C2')?.bold, undefined);
  assert.equal(styleOf('C2')?.underline, undefined);
});

test('italic, underline and size are read', () => {
  const style = styleOf('C1');
  assert.equal(style?.italic, true);
  assert.equal(style?.underline, true);
  assert.equal(style?.fontSizePt, 20);
});

// ---------------------------------------------------------------- fills and borders

test('a solid fill is read, and a pattern is not a colour', () => {
  assert.equal(styleOf('D1')?.fill, '#ffff00');
  assert.equal(styleOf('B2')?.fill, undefined, 'gray125 is a hatch, not a background');
  assert.equal(styleOf('A1')?.fill, undefined, 'patternType="none" is no fill');
});

test('a solid fill that names only a background colour still has one', () => {
  assert.equal(styleOf('A2')?.fill, '#92d050');
});

test('each border edge is read on its own', () => {
  const all = styleOf('D1');
  assert.deepEqual(
    { top: all?.borderTop, right: all?.borderRight, bottom: all?.borderBottom, left: all?.borderLeft },
    { top: true, right: true, bottom: true, left: true },
  );

  const partial = styleOf('A2');
  assert.equal(partial?.borderBottom, true);
  assert.equal(partial?.borderTop, undefined, 'style="none" is not an edge');
  assert.equal(partial?.borderLeft, undefined, 'an empty <left/> is not an edge');
});

// ---------------------------------------------------------------- alignment

test('horizontal alignment is read', () => {
  assert.equal(styleOf('E1')?.align, 'center');
  assert.equal(styleOf('F1')?.align, 'right');
});

test('"general" alignment is left unset', () => {
  // It means "decide from the content", which is what the app does when nothing is set.
  assert.equal(styleOf('C2')?.align, undefined);
});

// ---------------------------------------------------------------- the sheet

test('an unstyled cell has no entry', () => {
  assert.equal(styleOf('A1')?.bold, undefined);
  assert.equal(readXlsxCellStyles(STYLES, SHEET, THEME).has('0:0'), false);
});

test("a cell with no style of its own takes the row's", () => {
  // A formatted row is how a whole highlighted line arrives when its cells were never touched.
  assert.equal(styleOf('A3')?.bold, true);
  assert.equal(styleOf('A3')?.fontColor, '#cc0000');
});

test("a cell's own style wins over the row's", () => {
  assert.equal(styleOf('B3')?.align, 'right');
  assert.equal(styleOf('B3')?.bold, undefined, 'its own style replaces the row style');
});

test('a file with no styles at all reads as nothing, rather than throwing', () => {
  assert.equal(readXlsxCellStyles('', SHEET).size, 0);
  assert.equal(readXlsxCellStyles(STYLES, '').size, 0);
  assert.equal(readXlsxCellStyles('<styleSheet/>', '<worksheet/>').size, 0);
});

test('a theme the file does not include leaves theme colours unresolved', () => {
  // Better an uncoloured cell than a guessed colour that gets saved as the author's choice.
  const withoutTheme = readXlsxCellStyles(STYLES, SHEET);
  assert.equal(withoutTheme.get('1:0')?.fontColor, undefined);
  assert.equal(withoutTheme.get('1:0')?.fill, '#92d050', 'an explicit colour still reads');
});

test('namespaced XML is read the same way', () => {
  const prefixed = STYLES.replace(/<(\/?)(fonts|font|fills|fill|patternFill|fgColor|bgColor|borders|border|cellXfs|xf|alignment|sz|color|b|i|u|name|left|right|top|bottom|diagonal)(?=[\s/>])/g, '<$1x:$2');
  const table = parseXlsxStyleTable(prefixed, THEME);
  assert.equal(table[1]?.bold, true);
  assert.equal(table[1]?.fontColor, '#cc0000');
  assert.equal(table[4]?.align, 'center');
});

// ---------------------------------------------------------------- sheet parts

test('a sheet is matched to its part through the relationships', () => {
  /*
   * Parts are numbered in creation order, so the first sheet listed is not necessarily sheet1.xml —
   * reading the wrong part would dress one sheet's cells in another's formatting.
   */
  const workbook = `<workbook xmlns:r="http://x"><sheets>
      <sheet name="Second" sheetId="2" r:id="rId3"/>
      <sheet name="First" sheetId="1" r:id="rId1"/>
    </sheets></workbook>`;
  const rels = `<Relationships>
      <Relationship Id="rId1" Target="worksheets/sheet1.xml"/>
      <Relationship Id="rId3" Target="worksheets/sheet4.xml"/>
      <Relationship Id="rId9" Target="styles.xml"/>
    </Relationships>`;

  assert.deepEqual(sheetPartPaths(workbook, rels), [
    'xl/worksheets/sheet4.xml',
    'xl/worksheets/sheet1.xml',
  ]);
});

test('an absolute part target is left where it points', () => {
  const workbook = `<workbook xmlns:r="http://x"><sheets><sheet name="A" r:id="rId1"/></sheets></workbook>`;
  const rels = `<Relationships><Relationship Id="rId1" Target="/xl/worksheets/sheet2.xml"/></Relationships>`;
  assert.deepEqual(sheetPartPaths(workbook, rels), ['xl/worksheets/sheet2.xml']);
});

test('sheets with no usable relationship are skipped rather than guessed at', () => {
  assert.deepEqual(sheetPartPaths('', ''), []);
  const workbook = `<workbook xmlns:r="http://x"><sheets><sheet name="A" r:id="rIdMissing"/></sheets></workbook>`;
  assert.deepEqual(sheetPartPaths(workbook, '<Relationships/>'), []);
});
