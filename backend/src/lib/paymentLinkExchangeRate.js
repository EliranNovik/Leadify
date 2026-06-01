/**
 * Resolve ILS-per-unit rate to persist on payment_links.rate from checkout charge snapshot.
 * @param {object | null | undefined} pelecardRawResponse
 * @returns {number | null}
 */
function rateFromPelecardRawResponse(pelecardRawResponse) {
  if (!pelecardRawResponse || typeof pelecardRawResponse !== 'object') return null;
  const charge = pelecardRawResponse.pelecardCharge;
  if (!charge || typeof charge !== 'object') return null;
  const rate = Number(charge.rateToIls);
  if (!Number.isFinite(rate) || rate <= 0) return null;
  return rate;
}

module.exports = {
  rateFromPelecardRawResponse,
};
