/*
 * Scratch probe: with classic (always-visible) scrollbars, does the grid show only the bottom one?
 *
 * Scrollbars are painted red here so either one is impossible to miss. The left panel is the sheet
 * as it was — both bars — and the right one is the clipping wrapper the tab uses now.
 */
const puppeteer = require('puppeteer');

const CELL = '<td style="min-width:140px;height:40px;border:1px solid #ddd">cell</td>';
const TABLE = `<table style="border-collapse:collapse">${'<tr>' + CELL.repeat(8) + '</tr>'.repeat(1)}${(
  '<tr>' + CELL.repeat(8) + '</tr>'
).repeat(14)}</table>`;

const page = `<!doctype html>
<html><head><meta charset="utf-8"><style>
  body { margin: 0; padding: 16px; font-family: system-ui; display: flex; gap: 24px; background: #f3f4f6; }
  .panel { width: 420px; }
  h4 { margin: 0 0 6px; font-size: 12px; font-weight: 600; }

  /* Classic scrollbars, painted so they cannot be mistaken for anything else. */
  *::-webkit-scrollbar { width: 15px; height: 15px; background: #fee2e2; }
  *::-webkit-scrollbar-thumb { background: #dc2626; border-radius: 8px; }

  .before { height: 320px; overflow: auto; background: #fff; border-radius: 12px; }

  .clip { height: 320px; overflow: hidden; background: #fff; border-radius: 12px; }
  .scroller { height: 100%; overflow: auto; margin-inline-end: -15px; padding-inline-end: 15px; }
</style></head>
<body>
  <div class="panel">
    <h4>before — a scrollbar on both edges</h4>
    <div class="before" id="before">${TABLE}</div>
  </div>
  <div class="panel">
    <h4>after — only along the bottom</h4>
    <div class="clip" id="clip"><div class="scroller" id="scroller">${TABLE}</div></div>
  </div>
<script>
  window.report = () => {
    const clip = document.getElementById('clip');
    const scroller = document.getElementById('scroller');
    const before = document.getElementById('before');
    return {
      beforeHasVerticalBar: before.offsetWidth - before.clientWidth,
      beforeHasHorizontalBar: before.offsetHeight - before.clientHeight,
      scrollerVerticalBar: scroller.offsetWidth - scroller.clientWidth,
      scrollerHorizontalBar: scroller.offsetHeight - scroller.clientHeight,
      // How far the scrolling box overhangs its clipping parent.
      overhang: scroller.getBoundingClientRect().right - clip.getBoundingClientRect().right,
      // Everything still reachable: the whole table can be scrolled to.
      scrollableWidth: scroller.scrollWidth - scroller.clientWidth,
      scrollableHeight: scroller.scrollHeight - scroller.clientHeight,
    };
  };
</script>
</body></html>`;

(async () => {
  const browser = await puppeteer.launch({ executablePath: process.env.CHROME_PATH });
  const p = await browser.newPage();
  await p.setViewport({ width: 920, height: 400, deviceScaleFactor: 2 });
  await p.setContent(page);

  console.log(JSON.stringify(await p.evaluate(() => window.report()), null, 2));
  await p.screenshot({ path: 'grid-scrollbars-probe.png' });
  console.log('wrote grid-scrollbars-probe.png');

  await browser.close();
})();
