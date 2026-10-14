/*
 * Renders the WhatsApp theme against the real compiled Tailwind/DaisyUI CSS so the dark palette can
 * be eyeballed without logging into the app. Scratch tool; safe to delete.
 *
 *   npm run build && node scripts/preview-whatsapp-theme.cjs
 */
const fs = require('fs');
const path = require('path');
const puppeteer = require('puppeteer');

const root = path.join(__dirname, '..');

function readThemeCss() {
  const src = fs.readFileSync(path.join(root, 'src/lib/whatsappThemeCss.ts'), 'utf8');
  const body = src.match(/const WHATSAPP_THEME_CSS = `([\s\S]*?)`;/);
  if (!body) throw new Error('could not find WHATSAPP_THEME_CSS');
  // The source is a JS template literal, so collapse its escapes the way the runtime would.
  return body[1].replace(/\\\\/g, '\\');
}

function readTailwindCss() {
  const dir = path.join(root, 'dist/assets');
  const file = fs.readdirSync(dir).find((f) => f.startsWith('index-') && f.endsWith('.css'));
  if (!file) throw new Error('no built CSS found — run npm run build first');
  return fs.readFileSync(path.join(dir, file), 'utf8');
}

const surface = (theme) => `
<div class="${theme === 'dark' ? 'wa-dark' : 'wa-light'}" data-theme="${theme}" style="width:1400px">
  <div class="flex h-[520px] bg-gray-100">
    <div class="flex-shrink-0 w-[4.5rem] bg-gray-50 border-r border-gray-200 wa-panel-edge flex flex-col items-center pt-4 gap-4">
      <button class="btn btn-ghost btn-circle w-11 h-11 bg-gray-300 text-gray-900">A</button>
      <button class="btn btn-ghost btn-circle w-11 h-11 text-gray-600">M</button>
    </div>
    <div class="w-96 border-r border-gray-200 wa-panel-edge flex flex-col bg-white">
      <div class="px-4 pt-4 pb-1 bg-white">
        <div class="flex items-center gap-3">
          <h1 class="text-xl font-semibold text-gray-900 tracking-tight">Chats</h1>
          <button class="wa-theme-switch ml-auto">
            <span class="wa-theme-knob ${theme === 'dark' ? 'is-dark' : ''}"></span>
          </button>
        </div>
      </div>
      <div class="px-3 pb-3 pt-1 bg-white">
        <div class="relative">
          <input placeholder="Search conversations..." class="w-full pl-4 pr-4 py-2.5 bg-gray-100 border-0 rounded-full outline-none placeholder:text-gray-500" />
        </div>
      </div>
      <div class="divide-gray-100">
        <div class="flex items-center gap-3 px-4 py-3 bg-green-50 border-l-4 border-l-green-500">
          <div class="w-11 h-11 rounded-full bg-green-500 text-white flex items-center justify-center font-semibold">TB</div>
          <div class="min-w-0 flex-1">
            <div class="font-medium text-gray-900 truncate">Tamar Ben-David</div>
            <div class="line-clamp-2 text-sm text-gray-800 font-medium">Thanks, I sent the documents over this morning, please let me know if anything else is needed</div>
          </div>
          <div class="flex flex-col items-end gap-0.5 flex-shrink-0">
            <span class="wa-timestamp-unread text-green-600 font-bold text-sm">14:22</span>
            <span class="bg-green-100 text-green-700 rounded-full text-center font-semibold text-xs px-2 py-1 min-w-[20px]">2</span>
          </div>
        </div>
        <div class="flex items-center gap-3 px-4 py-3 border-transparent border-l-4">
          <div class="w-11 h-11 rounded-full bg-green-500 text-white flex items-center justify-center font-semibold">DL</div>
          <div class="min-w-0 flex-1">
            <div class="font-medium text-gray-900 truncate">Daniel Levi</div>
            <div class="line-clamp-2 text-sm text-gray-500">Can we move the meeting to next week? I am travelling on the original date we agreed</div>
          </div>
          <span class="wa-timestamp text-gray-500 text-sm self-start">Mon</span>
        </div>
      </div>
    </div>
    <div class="flex-1 flex flex-col relative bg-gray-100">
      <div class="absolute top-0 inset-x-0 z-40 flex items-center justify-between px-3 py-1.5 wa-chrome-edge bg-white/50 backdrop-blur-xl border-b border-white/40">
        <div class="flex items-center gap-2">
          <span class="text-sm font-semibold text-gray-900">Tamar Ben-David</span>
          <span class="text-xs text-gray-500 font-mono">(L230773)</span>
          <span class="flex items-center gap-1 px-2 py-1 rounded text-xs font-medium bg-yellow-100 text-yellow-700">21h 04m</span>
          <span class="flex items-center gap-1 px-2 py-1 rounded text-xs font-medium bg-red-100 text-red-700">Locked</span>
          <span class="flex items-center gap-1 px-2 py-1 rounded text-xs font-medium bg-violet-100 text-violet-800">Test</span>
          <span class="rounded-full bg-green-100 px-2 py-0.5 text-[10px] font-semibold text-green-700">Main</span>
        </div>
        <button class="btn btn-ghost btn-circle btn-sm">x</button>
      </div>
      <div class="flex-1 pt-14 px-4 flex flex-col gap-2 justify-end pb-4">
        <div class="wa-bubble-in bg-white text-gray-900 w-fit max-w-[70%] rounded-2xl px-3 py-2 shadow-sm">
          Hello, I wanted to ask about the next step.
          <div class="wa-timestamp mt-1 text-[12px] opacity-70 text-end">14:18</div>
        </div>
        <div class="text-black border border-transparent w-fit max-w-[70%] ml-auto rounded-2xl px-3 py-2 shadow-sm"
             style="background: var(--wa-bubble-out, #DCF8C6); color: var(--wa-bubble-out-text, #000)">
          Of course — I have just emailed the forms over.
          <div class="wa-timestamp mt-1 text-[12px] opacity-70 text-end">14:20 <svg class="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="#53bdeb" style="display:inline-block;vertical-align:middle"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5" d="M3 12l4 4L11 8"/><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5" d="M9 12l4 4L17 8"/></svg></div>
        </div>
        <div class="wa-bubble-in bg-white text-gray-900 w-fit max-w-[70%] rounded-2xl px-3 py-2 shadow-sm">
          Thanks, I sent the documents
          <div class="wa-timestamp mt-1 text-[12px] opacity-70 text-end">14:22</div>
        </div>
      </div>
      <div class="px-3 pb-3">
        <div class="wa-chrome-edge flex items-end w-full rounded-2xl border border-white/40 bg-white/90 shadow px-1 py-1 gap-1">
          <button class="btn btn-circle border border-gray-200 bg-white text-gray-700">+</button>
          <textarea class="textarea flex-1 resize-none bg-transparent" placeholder="Type a message"></textarea>
          <button class="btn btn-circle bg-green-500 text-white">></button>
        </div>
      </div>
    </div>
  </div>
</div>`;

(async () => {
  const html = `<!doctype html><html><head><meta charset="utf-8">
<style>${readTailwindCss()}</style>
<style>${readThemeCss()}</style>
<style>body{margin:0;padding:16px;background:#8891a5;font-family:Inter,system-ui,sans-serif}
.lbl{font:600 13px system-ui;color:#fff;margin:4px 0 6px}</style>
</head><body>
<div class="lbl">LIGHT</div>${surface('light')}
<div class="lbl" style="margin-top:20px">DARK</div>${surface('dark')}
</body></html>`;

  const out = path.join(root, 'whatsapp-theme-preview.png');
  const browser = await puppeteer.launch({
    args: ['--no-sandbox'],
    executablePath: process.env.CHROME_PATH || undefined,
  });
  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 1180, deviceScaleFactor: 1.5 });
  await page.setContent(html, { waitUntil: 'load' });
  await page.screenshot({ path: out, fullPage: true });
  await browser.close();
  console.log('wrote', out);
})();
