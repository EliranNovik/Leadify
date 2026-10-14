/**
 * Scratch harness: renders the Lead time report allocation header and sticky footer against the
 * real compiled CSS, in the over-100% state, so the refusal can be reviewed without an employee
 * context and a Supabase connection behind the page.
 *
 * Run with: CHROME_PATH="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" \
 *   node scripts/preview-allocation-overflow.cjs
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

/** Three leads left at full plus other work: the state the free sliders make easy to reach. */
const GRAND_TOTAL = 260;
const OVER_BY = GRAND_TOTAL - 100;

function header(total, over) {
  const isOver = over > 0;
  const isValid = !isOver && total === 100;
  const badge = isOver
    ? 'bg-gradient-to-r from-rose-500 to-red-600 text-white'
    : isValid
      ? 'bg-gradient-to-r from-emerald-500 to-teal-600 text-white'
      : 'bg-gradient-to-r from-amber-400 to-orange-500 text-white';
  const label = isOver ? 'Over the maximum' : isValid ? 'Total' : 'Current total';

  return `
  <div class="flex flex-wrap items-center justify-between gap-3 rounded-[18px] bg-white px-5 py-3.5 shadow-sm">
    <p class="text-sm text-gray-600">Allocate your day across other work and leads.
      <span class="ml-1 text-gray-400">· Clocked 8h 30m today</span>
    </p>
    <div class="inline-flex items-center gap-2.5 rounded-full pl-2.5 pr-4 py-1.5 shadow-sm ${badge}">
      <span class="flex h-8 w-8 items-center justify-center rounded-full bg-white/20 text-xs font-bold">${
        isValid ? '✓' : '!'
      }</span>
      <span class="leading-tight">
        <span class="block text-[10px] font-semibold uppercase tracking-wider opacity-90">${label}</span>
        <span class="text-base font-bold">${total}%</span>
      </span>
    </div>
  </div>`;
}

function footer(total, over) {
  const isOver = over > 0;
  return `
  <div class="mx-auto flex w-full max-w-6xl flex-wrap items-center justify-between gap-3 rounded-[18px] bg-white/95 px-5 py-4 shadow-lg ring-1 ring-black/5">
    <div class="text-sm text-gray-500">
      Not saved yet for this date
      <span class="ml-2 text-gray-400">· Other 20% · 3 lead(s) · ${total}% current</span>
      ${
        isOver
          ? `<span class="ml-2 font-semibold text-rose-600">· ${over}% over the 100% maximum</span>`
          : ''
      }
    </div>
    <div class="flex flex-wrap items-center gap-2">
      <button type="button" class="btn btn-ghost rounded-full px-6 shadow-sm">Reset</button>
      <button type="button" class="btn btn-primary rounded-full px-6 shadow-sm" ${
        isOver ? 'disabled' : ''
      }>Save allocation</button>
    </div>
  </div>`;
}

const html = `<!doctype html>
<html lang="en" data-theme="light">
<head><meta charset="utf-8"><style>${compiledCss()}</style></head>
<body class="bg-gray-100 p-6">
  <div class="mx-auto max-w-6xl space-y-4">
    <h1 class="text-sm font-semibold uppercase tracking-wider text-gray-500">Over the maximum — refused</h1>
    ${header(GRAND_TOTAL, OVER_BY)}
    ${footer(GRAND_TOTAL, OVER_BY)}
    <h1 class="pt-4 text-sm font-semibold uppercase tracking-wider text-gray-500">Under — still saves, balanced up</h1>
    ${header(60, 0)}
    ${footer(60, 0)}
    <h1 class="pt-4 text-sm font-semibold uppercase tracking-wider text-gray-500">Exactly 100%</h1>
    ${header(100, 0)}
    ${footer(100, 0)}
  </div>
</body></html>`;

(async () => {
  const browser = await puppeteer.launch({
    executablePath: process.env.CHROME_PATH,
    args: ['--no-sandbox'],
  });
  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 1000, deviceScaleFactor: 2 });
  await page.setContent(html, { waitUntil: 'load' });
  await page.screenshot({ path: path.join(root, 'allocation-overflow-preview.png'), fullPage: true });
  await browser.close();
  console.log('wrote allocation-overflow-preview.png');
})();
