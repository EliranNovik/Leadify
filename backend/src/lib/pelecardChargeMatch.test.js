const test = require('node:test');
const assert = require('node:assert/strict');

const {
  chargeMatchesExpectedAmount,
  pelecardChargeBelongsToPayment,
} = require('./pelecardChargeMatch');

test('a charge for the amount the row is collecting is credited', () => {
  assert.equal(chargeMatchesExpectedAmount(300000, 3000).ok, true);
  assert.equal(chargeMatchesExpectedAmount(100000, 1000).ok, true);
});

test('a sibling installment charge is not credited to this row', () => {
  /*
   * The case this exists for: a 1,000 installment adopted the 3,000 charge of another installment
   * on the same lead, because both are sent to Pelecard under the same ParamX.
   */
  const result = chargeMatchesExpectedAmount(300000, 1000);
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'amount_mismatch');
  assert.equal(result.chargedNis, 3000);
  assert.equal(result.expectedNis, 1000);
});

test('VAT and whole-shekel rounding are not treated as a different amount', () => {
  // Pelecard rounds a converted total to whole shekels, so up to 1 shekel of slack is expected.
  assert.equal(chargeMatchesExpectedAmount(196200, 1962.46).ok, true);
  assert.equal(chargeMatchesExpectedAmount(196200, 1961.54).ok, true);
  // Beyond that it is a different amount, not rounding.
  assert.equal(chargeMatchesExpectedAmount(196200, 2016.5).ok, false);
});

test('an unreadable amount blocks nothing', () => {
  /*
   * Older rows and some Open Finance payloads carry no total. Refusing those would stop genuine
   * payments while catching no misattribution, since the mismatch is the whole signal.
   */
  assert.equal(chargeMatchesExpectedAmount(null, 1000).reason, 'charge_amount_unknown');
  assert.equal(chargeMatchesExpectedAmount(0, 1000).ok, true);
  assert.equal(chargeMatchesExpectedAmount(300000, null).reason, 'expected_amount_unknown');
  assert.equal(chargeMatchesExpectedAmount(300000, 0).ok, true);
});

test('the charged amount is read from the real Pelecard result shape', () => {
  // DebitTotal is in agorot and is the actual shekels taken, which is why it beats Total.
  const verifyPayload = {
    pelecard: {
      ResultData: { DebitTotal: '300000', TransactionPelecardId: '3106024506' },
      StatusCode: '000',
    },
  };
  assert.equal(pelecardChargeBelongsToPayment({}, verifyPayload, 3000).ok, true);

  const mismatch = pelecardChargeBelongsToPayment({}, verifyPayload, 1000);
  assert.equal(mismatch.ok, false);
  assert.equal(mismatch.chargedNis, 3000);
});

test('a foreign-currency row is compared against its converted shekel total', () => {
  /*
   * The caller passes chargeAmountFromPayment(), which is pelecardCharge.chargeTotalNis when the
   * row was converted. Comparing against the pre-conversion figure would reject every such payment.
   */
  const verifyPayload = { pelecard: { ResultData: { DebitTotal: '1864000' } } };
  assert.equal(pelecardChargeBelongsToPayment({}, verifyPayload, 18640).ok, true);
  assert.equal(pelecardChargeBelongsToPayment({}, verifyPayload, 5000).ok, false);
});
