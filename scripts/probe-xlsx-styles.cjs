/**
 * Scratch probe: hand-builds an .xlsx with a yellow fill, a bold font and a right-to-left workbook
 * view, then reads it back with SheetJS to see exactly what the community build exposes.
 *
 * SheetJS cannot write cell styles, so round-tripping its own output would prove nothing about what
 * it can read. Hence the hand-built file.
 */
const JSZip = require('jszip');
const XLSX = require('xlsx');

const CONTENT_TYPES = `<?xml version="1.0" encoding="UTF-8"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
<Default Extension="xml" ContentType="application/xml"/>
<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>
<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>
</Types>`;

const ROOT_RELS = `<?xml version="1.0" encoding="UTF-8"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>
</Relationships>`;

const WB_RELS = `<?xml version="1.0" encoding="UTF-8"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>
<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
</Relationships>`;

/* rightToLeft="1" on the workbook view is how Excel records a Hebrew or Arabic sheet. */
const WORKBOOK = `<?xml version="1.0" encoding="UTF-8"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
<bookViews><workbookView rightToLeft="1"/></bookViews>
<sheets><sheet name="Sheet1" sheetId="1" r:id="rId1"/></sheets>
</workbook>`;

/*
 * Style 1: bold, underlined, 16pt, on a yellow solid fill.
 * Style 2: a plain cell on a green fill, to check a fill without a font.
 */
const STYLES = `<?xml version="1.0" encoding="UTF-8"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
<fonts count="2">
<font><sz val="11"/><name val="Calibri"/></font>
<font><b/><u/><sz val="16"/><name val="Calibri"/></font>
</fonts>
<fills count="4">
<fill><patternFill patternType="none"/></fill>
<fill><patternFill patternType="gray125"/></fill>
<fill><patternFill patternType="solid"><fgColor rgb="FFFFFF00"/><bgColor indexed="64"/></patternFill></fill>
<fill><patternFill patternType="solid"><fgColor rgb="FF92D050"/><bgColor indexed="64"/></patternFill></fill>
</fills>
<borders count="1"><border/></borders>
<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
<cellXfs count="3">
<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>
<xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1"/>
<xf numFmtId="0" fontId="0" fillId="3" borderId="0" xfId="0" applyFill="1"/>
</cellXfs>
</styleSheet>`;

/* A2 is Hebrew, to check the text comes through intact. */
const SHEET = `<?xml version="1.0" encoding="UTF-8"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
<sheetViews><sheetView rightToLeft="1" workbookViewId="0"/></sheetViews>
<sheetData>
<row r="1">
<c r="A1" t="inlineStr" s="1"><is><t>Styled header</t></is></c>
<c r="B1" t="inlineStr" s="2"><is><t>Green cell</t></is></c>
</row>
<row r="2">
<c r="A2" t="inlineStr"><is><t>&#1513;&#1501; &#1492;&#1500;&#1511;&#1493;&#1495;</t></is></c>
<c r="B2" t="inlineStr"><is><t>plain</t></is></c>
</row>
<row r="3"><c r="A3" s="2"/><c r="B3" s="2"/></row>
<row r="4"><c r="A4" t="inlineStr"><is><t>after the gap</t></is></c></row>
</sheetData>
</worksheet>`;

(async () => {
  const zip = new JSZip();
  zip.file('[Content_Types].xml', CONTENT_TYPES);
  zip.file('_rels/.rels', ROOT_RELS);
  zip.file('xl/workbook.xml', WORKBOOK);
  zip.file('xl/_rels/workbook.xml.rels', WB_RELS);
  zip.file('xl/styles.xml', STYLES);
  zip.file('xl/worksheets/sheet1.xml', SHEET);

  const buffer = await zip.generateAsync({ type: 'nodebuffer' });

  const wb = XLSX.read(buffer, { type: 'buffer', cellStyles: true });
  const ws = wb.Sheets[wb.SheetNames[0]];

  console.log('workbook RTL :', JSON.stringify(wb.Workbook?.Views));
  for (const address of ['A1', 'B1', 'A2', 'A3', 'A4']) {
    const cell = ws[address];
    console.log(`${address} value=${JSON.stringify(cell?.v)} s=${JSON.stringify(cell?.s)}`);
  }

  /* Does a blank-but-coloured row keep values and fills on the same line? */
  for (const blankrows of [false, true]) {
    const rows = XLSX.utils.sheet_to_json(ws, {
      header: 1,
      raw: false,
      defval: '',
      blankrows,
    });

    const range = XLSX.utils.decode_range(ws['!ref']);
    const fills = [];
    for (let r = range.s.r; r <= range.e.r; r += 1) {
      const line = [];
      for (let c = range.s.c; c <= range.e.c; c += 1) {
        const cell = ws[XLSX.utils.encode_cell({ r, c })];
        const fill = cell?.s;
        const rgb = fill?.patternType && fill.patternType !== 'none' ? fill?.fgColor?.rgb : null;
        line.push(typeof rgb === 'string' && rgb ? `#${rgb.slice(-6)}` : null);
      }
      fills.push(line);
    }

    console.log(`\n=== blankrows: ${blankrows} ===`);
    console.log('rows  :', rows.length, JSON.stringify(rows));
    console.log('fills :', fills.length, JSON.stringify(fills));
    const aligned = rows.length === fills.length;
    console.log('aligned with the fill table:', aligned);
  }
})();
