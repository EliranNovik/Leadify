/**
 * Scratch probe: hand-builds an .xlsx with cell borders, a column width and a row height, then reads
 * it back with SheetJS to see which of them the community build actually exposes.
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

const WORKBOOK = `<?xml version="1.0" encoding="UTF-8"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
<sheets><sheet name="Sheet1" sheetId="1" r:id="rId1"/></sheets>
</workbook>`;

/*
 * Border 1: a thin box on all four sides. Border 2: a thick bottom only, to tell "has any border"
 * apart from "has this particular edge". Alignment is on xf 2, to check horizontal alignment too.
 */
const STYLES = `<?xml version="1.0" encoding="UTF-8"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
<fonts count="1"><font><sz val="11"/><name val="Calibri"/></font></fonts>
<fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills>
<borders count="3">
<border/>
<border>
<left style="thin"><color rgb="FF000000"/></left>
<right style="thin"><color rgb="FF000000"/></right>
<top style="thin"><color rgb="FF000000"/></top>
<bottom style="thin"><color rgb="FF000000"/></bottom>
</border>
<border><bottom style="thick"><color rgb="FFFF0000"/></bottom></border>
</borders>
<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
<cellXfs count="4">
<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>
<xf numFmtId="0" fontId="0" fillId="0" borderId="1" xfId="0" applyBorder="1"/>
<xf numFmtId="0" fontId="0" fillId="0" borderId="2" xfId="0" applyBorder="1" applyAlignment="1"><alignment horizontal="center"/></xf>
<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0" applyAlignment="1"><alignment horizontal="right"/></xf>
</cellXfs>
</styleSheet>`;

/* A custom column width on B, and a custom row height on row 2. */
const SHEET = `<?xml version="1.0" encoding="UTF-8"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
<cols><col min="2" max="2" width="32.5" customWidth="1"/></cols>
<sheetData>
<row r="1">
<c r="A1" t="inlineStr" s="1"><is><t>boxed</t></is></c>
<c r="B1" t="inlineStr" s="2"><is><t>thick bottom, centred</t></is></c>
<c r="C1" t="inlineStr" s="3"><is><t>right aligned</t></is></c>
</row>
<row r="2" ht="42" customHeight="1">
<c r="A2" t="inlineStr"><is><t>tall row</t></is></c>
</row>
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

  for (const address of ['A1', 'B1', 'C1', 'A2']) {
    console.log(`${address} v=${JSON.stringify(ws[address]?.v)} s=${JSON.stringify(ws[address]?.s)}`);
  }
  console.log('\n!cols :', JSON.stringify(ws['!cols']));
  console.log('!rows :', JSON.stringify(ws['!rows']));
})();
