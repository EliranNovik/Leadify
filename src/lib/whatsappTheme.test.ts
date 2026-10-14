import test from 'node:test';
import assert from 'node:assert/strict';

import { WHATSAPP_DARK_CLASS, WHATSAPP_LIGHT_CLASS, readWhatsAppDark } from './whatsappTheme';
import WHATSAPP_THEME_CSS from './whatsappThemeCss';
import {
  WHATSAPP_CHAT_BUBBLE_META_CLASS,
  WHATSAPP_CONTACT_PANEL_WIDTH_CLASS,
  WHATSAPP_PANEL_EDGE_CLASS,
  WHATSAPP_TIMESTAMP_CLASS,
  whatsAppTimestampClass,
  WHATSAPP_OUTGOING_LINK_COLOR,
  WHATSAPP_OUTGOING_MESSAGE_GRADIENT,
  WHATSAPP_OUTGOING_TEXT_COLOR,
  WHATSAPP_READ_RECEIPT_COLOR,
  WHATSAPP_SENT_RECEIPT_COLOR,
} from './whatsappOutgoingMessageStyle';

type StoredValue = string | null;

function withLocalStorage(value: StoredValue | (() => never), run: () => void): void {
  const globals = globalThis as { localStorage?: unknown };
  const had = 'localStorage' in globals;
  const previous = globals.localStorage;
  globals.localStorage = {
    getItem: () => (typeof value === 'function' ? value() : value),
    setItem: () => {},
  };
  try {
    run();
  } finally {
    if (had) globals.localStorage = previous;
    else delete globals.localStorage;
  }
}

test('defaults to light when nothing has been chosen', () => {
  withLocalStorage(null, () => {
    assert.equal(readWhatsAppDark(), false);
  });
});

test('honours a stored dark choice', () => {
  withLocalStorage('dark', () => {
    assert.equal(readWhatsAppDark(), true);
  });
});

test('honours a stored light choice', () => {
  withLocalStorage('light', () => {
    assert.equal(readWhatsAppDark(), false);
  });
});

test('falls back to light when storage is unavailable', () => {
  // Private browsing and blocked-storage settings throw on access rather than returning null.
  withLocalStorage(
    () => {
      throw new Error('SecurityError');
    },
    () => {
      assert.equal(readWhatsAppDark(), false);
    },
  );
});

test('the two root classes are distinct, so a surface is never both', () => {
  assert.notEqual(WHATSAPP_DARK_CLASS, WHATSAPP_LIGHT_CLASS);
});

/*
 * The stylesheet is a template literal, and a stray backtick in one of its CSS comments ends the
 * literal early. That still parses and still builds — the tail becomes a tagged template call — so
 * it only shows up as a ReferenceError when the page loads. Importing the module at all is the real
 * assertion here; the checks below just confirm it arrived whole.
 */
test('the dark stylesheet is a complete, non-empty string', () => {
  assert.equal(typeof WHATSAPP_THEME_CSS, 'string');
  assert.ok(WHATSAPP_THEME_CSS.length > 2000, `only ${WHATSAPP_THEME_CSS.length} characters`);
  assert.ok(WHATSAPP_THEME_CSS.trimEnd().endsWith('}'), 'stylesheet is truncated');
});

test('the dark stylesheet carries no backticks, which would truncate it', () => {
  assert.equal(WHATSAPP_THEME_CSS.includes('`'), false);
});

test('braces in the dark stylesheet balance', () => {
  const open = (WHATSAPP_THEME_CSS.match(/\{/g) || []).length;
  const close = (WHATSAPP_THEME_CSS.match(/\}/g) || []).length;
  assert.equal(open, close);
});

/*
 * The bubble colours are inline style values, so they are the one part of the theme a stylesheet
 * cannot reach. They work by naming a variable the stylesheet defines, which means a rename on
 * either side would leave outgoing bubbles light green on a dark thread with nothing to flag it.
 */
test('every variable the bubble colours reference is defined by the dark stylesheet', () => {
  const inlineValues = [
    WHATSAPP_OUTGOING_MESSAGE_GRADIENT,
    WHATSAPP_OUTGOING_TEXT_COLOR,
    WHATSAPP_OUTGOING_LINK_COLOR,
    WHATSAPP_READ_RECEIPT_COLOR,
    WHATSAPP_SENT_RECEIPT_COLOR,
  ];

  const referenced = inlineValues.flatMap((value) =>
    [...value.matchAll(/var\((--[a-z0-9-]+)/g)].map((match) => match[1]),
  );
  assert.equal(referenced.length, inlineValues.length, 'every colour should read one variable');

  for (const name of referenced) {
    assert.ok(WHATSAPP_THEME_CSS.includes(`${name}:`), `stylesheet never defines ${name}`);
  }
});

test('the bubble colours keep a light fallback, so light mode needs no stylesheet', () => {
  for (const value of [WHATSAPP_OUTGOING_MESSAGE_GRADIENT, WHATSAPP_OUTGOING_TEXT_COLOR]) {
    assert.match(value, /var\(--[a-z0-9-]+,\s*#[0-9a-fA-F]{3,8}\)/, value);
  }
});

test('the contacts panel width is a single shared value across the surfaces', () => {
  assert.match(WHATSAPP_CONTACT_PANEL_WIDTH_CLASS, /^w-/);
});

/*
 * Read and unread timestamps must not share a hook. Both states are styled under .wa-dark, so an
 * element carrying both would be decided by stylesheet order, and an unread row would lose its green.
 */
test('read and unread timestamps use different hooks, each styled for dark', () => {
  const read = whatsAppTimestampClass(false).split(' ');
  const unread = whatsAppTimestampClass(true).split(' ');

  const hookOf = (classes: string[]) => classes.filter((name) => name.startsWith('wa-timestamp'));
  assert.deepEqual(hookOf(read), [WHATSAPP_TIMESTAMP_CLASS]);
  assert.equal(hookOf(unread).length, 1);
  assert.notDeepEqual(hookOf(unread), hookOf(read));

  for (const hook of [...hookOf(read), ...hookOf(unread)]) {
    assert.ok(WHATSAPP_THEME_CSS.includes(`.wa-dark .${hook} `), `dark theme never styles ${hook}`);
  }
});

test('an unread timestamp is green and bold, a read one is neither', () => {
  const unread = whatsAppTimestampClass(true);
  assert.match(unread, /text-green-/);
  assert.match(unread, /font-bold/);

  const read = whatsAppTimestampClass(false);
  assert.doesNotMatch(read, /text-green-|font-bold/);
});

test('bubble timestamps carry the timestamp hook, so they whiten with the list ones', () => {
  assert.ok(
    WHATSAPP_CHAT_BUBBLE_META_CLASS.split(' ').includes(WHATSAPP_TIMESTAMP_CLASS),
    WHATSAPP_CHAT_BUBBLE_META_CLASS,
  );
});

/*
 * The timestamp and panel-edge rules tie with the generic grey and border rules on specificity, so
 * the only thing making them win is coming later in the file. Reordering the stylesheet would
 * silently return timestamps to grey and put the panel outline back.
 */
test('the hook rules come after the generic rules they are meant to override', () => {
  const at = (selector: string) => {
    const index = WHATSAPP_THEME_CSS.indexOf(selector);
    assert.notEqual(index, -1, `stylesheet is missing ${selector}`);
    return index;
  };

  for (const generic of ['.wa-dark .text-gray-500', '.wa-dark .text-gray-400']) {
    assert.ok(at(`.wa-dark .${WHATSAPP_TIMESTAMP_CLASS}`) > at(generic), `${generic} must come first`);
  }
  for (const generic of ['.wa-dark .border-gray-200', '.wa-dark .border-gray-300']) {
    assert.ok(at(`.wa-dark .${WHATSAPP_PANEL_EDGE_CLASS}`) > at(generic), `${generic} must come first`);
  }
  for (const generic of ['.wa-dark .border-white', '.wa-dark .border-gray-200']) {
    assert.ok(at('.wa-dark .wa-chrome-edge') > at(generic), `${generic} must come first`);
  }
  // Same tie, same reason: incoming bubbles override the plain white-surface rule.
  assert.ok(at('.wa-dark .wa-bubble-in') > at('.wa-dark .bg-white'));
});

test('every rule is scoped so light mode and the rest of the app are untouched', () => {
  const stray = WHATSAPP_THEME_CSS.split('\n')
    .map((line) => line.trim())
    // Selector lines only: skip declarations, comments and at-rule bodies.
    .filter((line) => /[{,]$/.test(line) || /^\S.*\{/.test(line))
    .filter((line) => !line.startsWith('@') && !line.startsWith('*'))
    .filter((line) => !line.startsWith('.wa-dark') && !line.startsWith('.wa-theme-'));
  assert.deepEqual(stray, []);
});
