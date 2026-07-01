const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const {
  BUSINESS_TZ,
  clientLocalToJerusalem,
  jerusalemToClientLocal,
  formatDualBookingTime,
  isValidIanaTimezone,
} = require('./bookingTimezone');

describe('bookingTimezone', () => {
  it('validates IANA timezones', () => {
    assert.equal(isValidIanaTimezone('America/New_York'), true);
    assert.equal(isValidIanaTimezone('Not/AZone'), false);
  });

  it('Jerusalem fast-path keeps wall time unchanged', () => {
    const result = clientLocalToJerusalem('2026-07-14', '10:30', BUSINESS_TZ);
    assert.deepEqual(result, { date: '2026-07-14', time: '10:30' });
    const back = jerusalemToClientLocal('2026-07-14', '10:30', BUSINESS_TZ);
    assert.deepEqual(back, { date: '2026-07-14', time: '10:30' });
  });

  it('converts New York evening to next-day Jerusalem morning', () => {
    // 2026-07-13 20:00 EDT = 2026-07-14 03:00 Jerusalem (EDT UTC-4, Jerusalem UTC+3)
    const result = clientLocalToJerusalem('2026-07-13', '20:00', 'America/New_York');
    assert.ok(result);
    assert.equal(result.date, '2026-07-14');
    assert.equal(result.time, '03:00');
  });

  it('round-trips Jerusalem to client local', () => {
    const jerusalem = { date: '2026-07-14', time: '15:00' };
    const client = jerusalemToClientLocal(jerusalem.date, jerusalem.time, 'America/New_York');
    assert.ok(client);
    const back = clientLocalToJerusalem(client.date, client.time, 'America/New_York');
    assert.deepEqual(back, jerusalem);
  });

  it('formatDualBookingTime includes both zones for international clients', () => {
    const dual = formatDualBookingTime('2026-07-14', '15:00', 'America/New_York');
    assert.match(dual, /your time/i);
    assert.match(dual, /Israel time/i);
  });

  it('formatDualBookingTime shows single zone for Jerusalem clients', () => {
    const dual = formatDualBookingTime('2026-07-14', '15:00', BUSINESS_TZ);
    assert.doesNotMatch(dual, /your time/i);
    assert.ok(dual.length > 0);
  });
});
