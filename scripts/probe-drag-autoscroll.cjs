/*
 * Scratch probe: does a selection drag held at the sheet's edge keep scrolling and keep selecting?
 *
 * The algorithm below is the one in CaseHandlingTab — the edge strip, the speed ramp, and resolving
 * the cell under the pointer from coordinates. Driven by a real pointer so the case it exists for is
 * the case under test: the mouse stops moving and the sheet has to carry on by itself.
 */
const puppeteer = require('puppeteer');

const AUTOSCROLL_EDGE = 56;
const AUTOSCROLL_MAX_STEP = 22;
const COLUMNS = 30;
const ROWS = 40;

const page = `<!doctype html>
<html><head><meta charset="utf-8"><style>
  body { margin: 0; padding: 20px; font-family: system-ui; }
  #clip { width: 600px; height: 300px; overflow: hidden; border: 1px solid #999; }
  #scroller { height: 100%; overflow: auto; }
  table { border-collapse: collapse; table-layout: fixed; width: ${COLUMNS * 120}px; }
  /* The sheet turns selection off while dragging, which also rules out Chrome's own autoscroll. */
  #scroller { user-select: none; }
  td, th { width: 120px; height: 32px; border: 1px solid #ddd; font-size: 12px; text-align: center; }
  th { background: #eee; }
  .picked { background: #c7d2fe; }
</style></head>
<body>
<div id="clip"><div id="scroller">
  <table>
    <thead><tr>${Array.from(
      { length: COLUMNS },
      (_, c) => `<th data-cell-col="${c}">C${c}</th>`,
    ).join('')}</tr></thead>
    <tbody>${Array.from(
      { length: ROWS },
      (_, r) =>
        `<tr>${Array.from(
          { length: COLUMNS },
          (_, c) => `<td data-cell-row="${r}" data-cell-col="${c}">${r},${c}</td>`,
        ).join('')}</tr>`,
    ).join('')}</tbody>
  </table>
</div></div>
<script>
  const EDGE = ${AUTOSCROLL_EDGE};
  const MAX = ${AUTOSCROLL_MAX_STEP};
  const container = document.getElementById('scroller');

  window.state = { dragging: false, anchor: null, focus: null, frames: 0 };

  function cellFromPoint(x, y, fallback) {
    const target = document.elementFromPoint(x, y);
    const cell = target && target.closest('[data-cell-row], [data-cell-col]');
    if (!cell) return null;
    const row = cell.getAttribute('data-cell-row');
    const col = cell.getAttribute('data-cell-col');
    const rowIndex = row == null ? fallback && fallback.rowIndex : Number(row);
    const colIndex = col == null ? fallback && fallback.colIndex : Number(col);
    if (!Number.isInteger(rowIndex) || !Number.isInteger(colIndex)) return null;
    return { rowIndex, colIndex };
  }

  function speed(position, start, end) {
    if (position > end - EDGE) {
      return Math.ceil(Math.min(1, (position - (end - EDGE)) / EDGE) * MAX);
    }
    if (position < start + EDGE) {
      return -Math.ceil(Math.min(1, (start + EDGE - position) / EDGE) * MAX);
    }
    return 0;
  }

  const pointer = { x: 0, y: 0, seen: false };
  document.addEventListener('mousedown', (event) => {
    const cell = cellFromPoint(event.clientX, event.clientY, { rowIndex: 0, colIndex: 0 });
    if (!cell) return;
    window.state.dragging = true;
    window.state.anchor = cell;
    window.state.focus = cell;
    loop();
  });
  document.addEventListener('mouseup', () => { window.state.dragging = false; });
  window.addEventListener('mousemove', (event) => {
    pointer.x = event.clientX;
    pointer.y = event.clientY;
    pointer.seen = true;
    if (window.state.dragging) {
      const cell = cellFromPoint(event.clientX, event.clientY, window.state.anchor);
      if (cell) window.state.focus = cell;
    }
  });

  function loop() {
    if (!window.state.dragging) return;
    requestAnimationFrame(loop);
    if (!pointer.seen) return;

    const bounds = container.getBoundingClientRect();
    const dx = speed(pointer.x, bounds.left, bounds.right);
    const dy = speed(pointer.y, bounds.top, bounds.bottom);
    if (dx === 0 && dy === 0) return;

    const before = { left: container.scrollLeft, top: container.scrollTop };
    container.scrollBy(dx, dy);
    if (container.scrollLeft === before.left && container.scrollTop === before.top) return;

    window.state.frames += 1;
    const cell = cellFromPoint(pointer.x, pointer.y, window.state.anchor);
    if (cell) window.state.focus = cell;
  }
</script>
</body></html>`;

const read = (p) =>
  p.evaluate(() => ({
    scrollLeft: Math.round(document.getElementById('scroller').scrollLeft),
    maxScrollLeft: Math.round(
      document.getElementById('scroller').scrollWidth -
        document.getElementById('scroller').clientWidth,
    ),
    focus: window.state.focus,
    frames: window.state.frames,
  }));

(async () => {
  const browser = await puppeteer.launch({ executablePath: process.env.CHROME_PATH });
  const p = await browser.newPage();
  p.on('console', (message) => console.log('   [page]', message.text()));
  await p.setViewport({ width: 800, height: 420 });
  await p.setContent(page);

  const box = await p.evaluate(() => {
    const r = document.getElementById('clip').getBoundingClientRect();
    return { left: r.left, right: r.right, top: r.top, bottom: r.bottom };
  });

  // Start a drag on the first visible column heading, as marking columns does.
  await p.mouse.move(box.left + 40, box.top + 16);
  await p.mouse.down();
  console.log('on mousedown:', JSON.stringify(await read(p)));

  // Drag to the right-hand edge and then stop moving — the sheet has to carry on by itself.
  await p.mouse.move(box.right - 12, box.top + 16);
  const atEdge = await read(p);
  console.log('just arrived at the edge:', JSON.stringify(atEdge));

  await new Promise((resolve) => setTimeout(resolve, 600));
  const held = await read(p);
  console.log('after holding still 600ms:', JSON.stringify(held));

  await new Promise((resolve) => setTimeout(resolve, 2500));
  const far = await read(p);
  console.log('after holding still 3.1s:', JSON.stringify(far));

  await p.mouse.up();

  /*
   * And well away from either edge it stays put rather than drifting. Measured in frames, not in
   * scroll position: at the far end there is nowhere left to scroll, so the position alone would
   * pass whether the loop was running or not.
   */
  await p.evaluate(() => {
    document.getElementById('scroller').scrollLeft = 600;
  });
  await p.mouse.move(box.left + 300, box.top + 16);
  await p.mouse.down();
  const beforeHold = await read(p);
  await new Promise((resolve) => setTimeout(resolve, 400));
  const middle = await read(p);
  await p.mouse.up();
  console.log('\\npointer in the middle, held 400ms:', JSON.stringify(middle));

  console.log('\\nchecks');
  console.log(`  scrolled while the pointer was still: ${held.scrollLeft > atEdge.scrollLeft}`);
  console.log(`  selection grew with it: ${held.focus.colIndex > atEdge.focus.colIndex}`);
  console.log(`  reached the far end: ${far.scrollLeft === far.maxScrollLeft}`);
  console.log(`  selected the last column: ${far.focus.colIndex === COLUMNS - 1}`);
  console.log(
    `  no scrolling away from the edge: ${
      middle.frames === beforeHold.frames && middle.scrollLeft === beforeHold.scrollLeft
    }`,
  );

  await browser.close();
})();
