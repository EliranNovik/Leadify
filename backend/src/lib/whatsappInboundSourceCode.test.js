const test = require('node:test');
const assert = require('node:assert/strict');
const { extractParenthesizedSourceCode } = require('./whatsappInboundSourceCode');

test('reads the source code from a landing-page WhatsApp message', () => {
  const text =
    'שלום, אני מעוניין/ת לקבל מידע על הסדרת מעמד לבן או בת זוג בישראל (22018) ואשמח לקבל פרטים נוספים';
  assert.equal(extractParenthesizedSourceCode(text), 22018);
});

test('uses the last parenthesized number when a message has more than one', () => {
  assert.equal(extractParenthesizedSourceCode('call (12) then code (44001)'), 44001);
});

test('ignores messages with no source code', () => {
  assert.equal(extractParenthesizedSourceCode('שלום, אשמח לפרטים'), null);
  assert.equal(extractParenthesizedSourceCode(''), null);
  assert.equal(extractParenthesizedSourceCode(null), null);
});
