/**
 * Scratch harness: renders the Lead time report heading row against the real compiled CSS, so the
 * missing-reports strip can be reviewed beside the date box without an employee context behind the
 * page. The third block forces the dropdown open to check the backlog menu.
 *
 * Run with: CHROME_PATH="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" \
 *   node scripts/preview-missing-reports-strip.cjs
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

const WORK_DATE = '2026-10-14';

/** Wednesday 14 Oct 2026, a week that opened on Sunday the 11th, with a backlog behind it. */
const THIS_WEEK = ['2026-10-11', '2026-10-12', '2026-10-13', '2026-10-14'];
const EARLIER = [
  '2026-08-06',
  '2026-09-03',
  '2026-09-28',
  '2026-10-01',
  '2026-10-07',
  '2026-10-08',
];

const TODAY = WORK_DATE;
const YESTERDAY = '2026-10-13';

function tabLabel(iso) {
  if (iso === TODAY) return 'Today';
  if (iso === YESTERDAY) return 'Yesterday';
  const [y, m, d] = iso.split('-').map(Number);
  return new Intl.DateTimeFormat('en-GB', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
  }).format(new Date(y, m - 1, d));
}

function menuLabel(iso) {
  const [y, m, d] = iso.split('-');
  const name =
    iso === TODAY
      ? 'Today'
      : iso === YESTERDAY
        ? 'Yesterday'
        : new Intl.DateTimeFormat('en-GB', { weekday: 'long' }).format(
            new Date(Number(y), Number(m) - 1, Number(d)),
          );
  return `${name}, ${d}.${m}.${y}`;
}

function tab(active) {
  return `rounded-full px-4 py-2 text-sm font-semibold leading-none transition ${
    active
      ? 'bg-white text-gray-900 shadow-sm'
      : 'text-gray-600 hover:bg-white/60 hover:text-gray-900'
  }`;
}

function header({ thisWeek, earlier, open = false }) {
  const total = thisWeek.length + earlier.length;

  return `
  <div class="min-w-0">
    <p class="mb-1.5 text-lg font-medium text-gray-700">Welcome, Tamar Ben David</p>
    <div class="flex flex-wrap items-center gap-3">
      <h1 class="flex items-center gap-2.5 text-2xl font-bold text-gray-900">
        <span class="h-7 w-7 shrink-0 rounded bg-primary/20"></span>
        Daily lead allocation
      </h1>
      <label class="inline-flex items-center gap-2">
        <input type="date" value="${WORK_DATE}"
          class="input h-10 min-h-10 w-auto min-w-[10.5rem] rounded-[14px] border-0 bg-white px-3 ring-1 ring-gray-300/80" />
      </label>
      ${
        total > 0
          ? `<div class="flex min-w-0 flex-wrap items-center gap-2">
        <span class="inline-flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-amber-700">
          Missing
          <span class="rounded-full bg-red-500 px-2 py-0.5 text-[10px] font-bold tabular-nums text-white">${total}</span>
        </span>
        <div class="flex min-w-0 flex-wrap items-center gap-1 rounded-full bg-gray-200/80 p-1">
        ${thisWeek
          .map(
            (day) =>
              `<button type="button" class="${tab(day === WORK_DATE)}">${tabLabel(day)}</button>`,
          )
          .join('\n        ')}
        ${
          earlier.length > 0
            ? `<div class="dropdown dropdown-end ${open ? 'dropdown-open' : ''}">
          <div tabindex="0" role="button" class="${tab(false)}">${earlier.length} more</div>
          <ul class="dropdown-content menu z-[60] mt-2 max-h-80 w-60 flex-nowrap overflow-y-auto rounded-2xl bg-white p-2 shadow-xl ring-1 ring-black/5">
            ${earlier
              .map(
                (day) =>
                  `<li><button type="button" class="justify-start whitespace-nowrap text-xs font-semibold text-gray-600">${menuLabel(
                    day,
                  )}</button></li>`,
              )
              .join('\n            ')}
          </ul>
        </div>`
            : ''
        }
        </div>
      </div>`
          : ''
      }
    </div>
  </div>`;
}

const html = `<!doctype html>
<html lang="en" data-theme="light">
<head><meta charset="utf-8"><style>${compiledCss()}</style></head>
<body class="bg-[#ececec] p-6">
  <div class="mx-auto max-w-6xl space-y-8">
    <section>
      <h2 class="mb-2 text-xs font-semibold uppercase tracking-wider text-gray-500">This week + a backlog</h2>
      ${header({ thisWeek: THIS_WEEK, earlier: EARLIER })}
    </section>
    <section>
      <h2 class="mb-2 text-xs font-semibold uppercase tracking-wider text-gray-500">Only this week</h2>
      ${header({ thisWeek: THIS_WEEK, earlier: [] })}
    </section>
    <section>
      <h2 class="mb-2 text-xs font-semibold uppercase tracking-wider text-gray-500">Backlog menu open</h2>
      ${header({ thisWeek: THIS_WEEK, earlier: EARLIER, open: true })}
      <div class="h-64"></div>
    </section>
    <section>
      <h2 class="mb-2 text-xs font-semibold uppercase tracking-wider text-gray-500">Nothing missing</h2>
      ${header({ thisWeek: [], earlier: [] })}
    </section>
    <section>
      <h2 class="mb-2 text-xs font-semibold uppercase tracking-wider text-gray-500">Hours form — base hours beside From</h2>
      <div class="rounded-[18px] bg-white px-5 py-4 shadow-sm">
        <div class="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <div class="flex items-end gap-2">
            <label class="block min-w-0 flex-1">
              <span class="mb-1.5 block text-sm font-medium text-gray-600">From</span>
              <input type="time" value="09:00" class="input h-10 min-h-10 w-full rounded-[14px] border-0 bg-transparent px-3 ring-1 ring-gray-300/80" />
            </label>
            <button type="button" class="btn btn-ghost h-10 min-h-10 shrink-0 whitespace-nowrap rounded-[14px] border-0 px-3 text-xs font-semibold text-primary ring-1 ring-gray-300/80">Base hours</button>
          </div>
          <label class="block">
            <span class="mb-1.5 block text-sm font-medium text-gray-600">To</span>
            <input type="time" value="18:00" class="input h-10 min-h-10 w-full rounded-[14px] border-0 bg-transparent px-3 ring-1 ring-gray-300/80" />
          </label>
          <label class="block">
            <span class="mb-1.5 flex items-center gap-1.5 text-sm font-medium text-gray-600">Worked in</span>
            <select class="select h-10 min-h-10 w-full rounded-[14px] border-0 bg-transparent px-3 ring-1 ring-gray-300/80"><option>Tel Aviv office</option></select>
          </label>
        </div>
      </div>
    </section>
  </div>
</body></html>`;

(async () => {
  const browser = await puppeteer.launch({
    executablePath: process.env.CHROME_PATH,
    args: ['--no-sandbox'],
  });
  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 1100, deviceScaleFactor: 2 });
  await page.setContent(html, { waitUntil: 'load' });
  await page.screenshot({ path: path.join(root, 'missing-reports-strip-preview.png'), fullPage: true });

  // Narrow, to check the strip wraps under the date box instead of squeezing the heading.
  await page.setViewport({ width: 480, height: 900, deviceScaleFactor: 2 });
  await page.screenshot({
    path: path.join(root, 'missing-reports-strip-narrow.png'),
    fullPage: true,
  });
  await browser.close();
  console.log('wrote missing-reports-strip-preview.png and missing-reports-strip-narrow.png');
})();
