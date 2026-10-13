/**
 * Does this Pelecard charge belong to this payment link?
 *
 * Pelecard identifies a charge by ParamX, which we build as `{leadNumber}-{plan_contact_id}` — the
 * same string for every installment on a case. So "is there an approved charge under this
 * reference?" can answer yes about a *sibling* installment, and the row being reconciled would adopt
 * a charge it never had. That is how an uncharged installment reached `status = 'paid'` carrying
 * another row's approval number and amount.
 *
 * The amount is the one piece of the charge that is specific to the row, so it is what decides.
 */

const { extractTransactionTotalAgorot } = require('./pelecardTransactionFields');

/**
 * Agorot of slack allowed between the charge and the row.
 *
 * Covers VAT rounding and the agorot Pelecard drops when a converted total is rounded to whole
 * shekels. Anything beyond this is a different amount, not a rounding difference.
 */
const CHARGE_MATCH_TOLERANCE_AGOROT = 100;

/**
 * @param {number|null} chargedAgorot What Pelecard actually debited, in agorot.
 * @param {number|null} expectedNis What this row is collecting, in shekels, after any conversion.
 * @returns {{ ok: boolean, reason: string, chargedNis: number|null, expectedNis: number|null }}
 */
function chargeMatchesExpectedAmount(chargedAgorot, expectedNis) {
  const charged = Number(chargedAgorot);
  const expected = Number(expectedNis);

  /*
   * Unverifiable, not mismatched. Older rows and some Open Finance payloads carry no total, and
   * refusing those would block genuine payments to catch nothing — the mismatch is the signal.
   */
  if (!Number.isFinite(charged) || charged <= 0) {
    return { ok: true, reason: 'charge_amount_unknown', chargedNis: null, expectedNis: null };
  }
  if (!Number.isFinite(expected) || expected <= 0) {
    return {
      ok: true,
      reason: 'expected_amount_unknown',
      chargedNis: charged / 100,
      expectedNis: null,
    };
  }

  const expectedAgorot = Math.round(expected * 100);
  const delta = Math.abs(charged - expectedAgorot);

  if (delta <= CHARGE_MATCH_TOLERANCE_AGOROT) {
    return { ok: true, reason: 'match', chargedNis: charged / 100, expectedNis: expected };
  }

  return {
    ok: false,
    reason: 'amount_mismatch',
    chargedNis: charged / 100,
    expectedNis: expected,
  };
}

/**
 * Same decision, taken straight from a callback + GetTransaction payload.
 *
 * `expectedNis` must already be the shekel amount actually being charged, so callers pass
 * `chargeAmountFromPayment(payment)` rather than `total_amount`: a foreign-currency row collects a
 * converted total, and comparing against the pre-conversion figure would reject every one of them.
 */
function pelecardChargeBelongsToPayment(callbackData, verifyPayload, expectedNis) {
  const chargedAgorot = extractTransactionTotalAgorot(callbackData, verifyPayload);
  return chargeMatchesExpectedAmount(chargedAgorot, expectedNis);
}

module.exports = {
  CHARGE_MATCH_TOLERANCE_AGOROT,
  chargeMatchesExpectedAmount,
  pelecardChargeBelongsToPayment,
};
