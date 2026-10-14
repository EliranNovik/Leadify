/*
 * Scratch probe: in a right-to-left sheet, which physical side does the column resize handle land
 * on, and does the edge the pointer grabbed travel with the pointer?
 *
 * Replicates the table's shape (table-fixed, colgroup, a trailing spacer col, an overflow-auto
 * parent) rather than reasoning about it, because the answer decides the sign of the resize delta.
 */
const puppeteer = require('puppeteer');

const WIDTHS = [160, 160, 160, 160];
const GUTTER = 56;

/*
 * `where` says which element carries dir. The app puts it on the table and leaves the document
 * left-to-right, and logical insets can resolve from the containing block rather than the element,
 * so the two arrangements are not safely assumed to be the same thing.
 */
function page(dir, where) {
  const onHtml = where === 'html' ? dir : 'ltr';
  const onTable = where === 'table' ? dir : '';
  const onScroller = where === 'scroller' ? dir : '';
  return `<!doctype html>
<html dir="${onHtml}"><head><meta charset="utf-8"><style>
  body { margin: 0; font-family: system-ui; }
  .scroller { overflow: auto; width: 600px; border: 1px solid #999; }
  table { border-collapse: collapse; table-layout: fixed; width: 100%; }
  th, td { border: 1px solid #ccc; height: 32px; }
  th { position: relative; background: #eee; }
  .handle { position: absolute; inset-inline-end: 0; top: 0; height: 100%; width: 6px; background: red; }
</style></head>
<body>
<div class="scroller" dir="${onScroller}">
  <table id="t" dir="${onTable}">
    <colgroup>
      <col id="gutter" style="width:${GUTTER}px">
      ${WIDTHS.map((w, i) => `<col id="col${i}" style="width:${w}px">`).join('')}
      <col>
    </colgroup>
    <thead><tr>
      <th></th>
      ${WIDTHS.map(
        (_, i) => `<th id="th${i}">C${i}<span class="handle" id="h${i}"></span></th>`,
      ).join('')}
      <th></th>
    </tr></thead>
    <tbody><tr><td></td>${WIDTHS.map(() => '<td></td>').join('')}<td></td></tr></tbody>
  </table>
</div>
<script>
  window.boxes = (i) => {
    const th = document.getElementById('th' + i).getBoundingClientRect();
    const h = document.getElementById('h' + i).getBoundingClientRect();
    return { thLeft: th.left, thRight: th.right, handleCenter: (h.left + h.right) / 2 };
  };
  window.setWidth = (i, px) => {
    document.getElementById('col' + i).style.width = px + 'px';
  };
</script>
</body></html>`;
}

(async () => {
  const browser = await puppeteer.launch({ executablePath: process.env.CHROME_PATH });

  for (const [dir, where] of [
    ['ltr', 'html'],
    ['rtl', 'html'],
    ['rtl', 'table'],
    ['rtl', 'scroller'],
  ]) {
    const p = await browser.newPage();
    await p.setViewport({ width: 900, height: 300 });
    await p.setContent(page(dir, where));

    const before = await p.evaluate(() => window.boxes(1));
    const side =
      Math.abs(before.handleCenter - before.thLeft) < Math.abs(before.handleCenter - before.thRight)
        ? 'LEFT edge of its own heading'
        : 'RIGHT edge of its own heading';

    console.log(`\ndir=${dir} (set on <${where}>)`);
    console.log(`  handle sits on the ${side}`);

    /*
     * Now the question that decides the sign: grow the column by 60px and see which way the edge
     * the pointer was holding actually moved.
     */
    await p.evaluate(() => window.setWidth(1, 220));
    const after = await p.evaluate(() => window.boxes(1));
    const moved = after.handleCenter - before.handleCenter;
    console.log(
      `  widening by 60px moved that handle ${moved > 0 ? 'RIGHT' : 'LEFT'} by ${Math.abs(
        Math.round(moved),
      )}px`,
    );
    console.log(
      `  => to follow the pointer, a drag that makes it wider must travel ${
        moved > 0 ? 'RIGHT (clientX increasing)' : 'LEFT (clientX decreasing)'
      }`,
    );
    await p.close();
  }

  await browser.close();
})();
