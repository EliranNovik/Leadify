/**
 * Resolve the ILS amount to charge via Pelecard (matches frontend BOI "Total (NIS)" display).
 */
const boiExchangeRatesService = require('./boiExchangeRatesService');

const ILS_ALIASES = new Set(['ILS', 'NIS']);
const CURRENCY_ID_TO_ISO = {
  1: 'ILS',
  2: 'EUR',
  3: 'USD',
  4: 'GBP',
};
const SYMBOL_TO_ISO = {
  $: 'USD',
  '€': 'EUR',
  '£': 'GBP',
  '₪': 'ILS',
};

function normalizeIso(raw) {
  if (!raw) return 'ILS';
  const upper = String(raw).trim().toUpperCase();
  if (upper === 'NIS' || upper === '₪') return 'ILS';
  return upper;
}

function isLocalCurrency(iso) {
  return ILS_ALIASES.has(normalizeIso(iso));
}

/**
 * @param {object} payment - payment_links row with currency + optional payment_plans
 */
function resolvePaymentIsoCode(payment) {
  const plan = payment.payment_plans || {};
  const currencyId = plan.currency_id ?? payment.currency_id;
  if (currencyId != null) {
    const id = typeof currencyId === 'number' ? currencyId : parseInt(String(currencyId), 10);
    if (CURRENCY_ID_TO_ISO[id]) return CURRENCY_ID_TO_ISO[id];
  }

  const text = String(payment.currency || plan.currency || '').trim();
  if (SYMBOL_TO_ISO[text]) return SYMBOL_TO_ISO[text];
  if (ILS_ALIASES.has(text.toUpperCase()) || text === '₪') return 'ILS';
  if (/^[A-Z]{3}$/.test(text.toUpperCase())) return text.toUpperCase();

  return 'ILS';
}

/**
 * @returns {Promise<{
 *   chargeTotalNis: number,
 *   originalTotal: number,
 *   originalCurrency: string,
 *   rateToIls: number,
 *   rateDate: string | null,
 *   converted: boolean,
 * }>}
 */
async function resolvePelecardChargeAmount(payment) {
  const originalTotal = Number(payment.total_amount);
  if (!Number.isFinite(originalTotal) || originalTotal <= 0) {
    const err = new Error('Invalid payment amount');
    err.code = 'INVALID_AMOUNT';
    throw err;
  }

  const iso = resolvePaymentIsoCode(payment);

  if (isLocalCurrency(iso)) {
    return {
      chargeTotalNis: Math.round(originalTotal),
      originalTotal,
      originalCurrency: 'ILS',
      rateToIls: 1,
      rateDate: null,
      converted: false,
    };
  }

  const rates = await boiExchangeRatesService.getLatestRates();
  const row = rates.find(
    (r) =>
      String(r.base_currency).toUpperCase() === iso &&
      String(r.target_currency).toUpperCase() === 'ILS',
  );

  if (!row || !Number.isFinite(Number(row.rate)) || Number(row.rate) <= 0) {
    const err = new Error(
      `No Bank of Israel exchange rate for ${iso}. Sync BOI rates in admin, then try again.`,
    );
    err.code = 'EXCHANGE_RATE_UNAVAILABLE';
    throw err;
  }

  const rateToIls = Number(row.rate);
  const chargeTotalNis = Math.round(originalTotal * rateToIls);

  return {
    chargeTotalNis,
    originalTotal,
    originalCurrency: iso,
    rateToIls,
    rateDate: row.rate_date || null,
    converted: true,
  };
}

function chargeAmountFromPayment(payment) {
  const stored = payment?.pelecard_raw_response?.pelecardCharge?.chargeTotalNis;
  if (stored != null && Number.isFinite(Number(stored))) {
    return Number(stored);
  }
  return Number(payment?.total_amount) || 0;
}

module.exports = {
  resolvePelecardChargeAmount,
  resolvePaymentIsoCode,
  chargeAmountFromPayment,
  isLocalCurrency,
};
