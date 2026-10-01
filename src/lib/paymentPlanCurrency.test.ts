import assert from 'node:assert/strict';
import test from 'node:test';

// resolveProformaCurrency awaits the accounting_currencies lookup. There is no Supabase here, so
// answer it with an empty list: the resolver is then driven purely by its own fallback table, which
// is the behaviour these tests are pinning down.
globalThis.fetch = (async () =>
  new Response('[]', { status: 200, headers: { 'Content-Type': 'application/json' } })) as typeof fetch;

import {
  displaySymbolForPaymentSave,
  mapLeadCurrencyToSymbol,
  normalizeProformaCurrencyFields,
  pickCurrencyId,
  pickCurrencyToken,
  proformaDisplayCurrency,
  resolveProformaCurrency,
  symbolFromCurrencyToken,
} from './paymentPlanCurrency';

/**
 * These all guard one bug: a proforma for a USD payment rendering as ₪.
 *
 * Every assertion below is a route by which a shekel sign used to be invented out of nothing — a
 * blank token, a mojibake'd one, a hard-coded 'ILS' from the public RPC, or a currency_id that was
 * read and then discarded. USD is accounting_currencies id 3.
 */
const USD_ID = 3;
const NIS_ID = 1;

test('a currency token that says nothing is unknown, not shekels', () => {
  assert.equal(symbolFromCurrencyToken(''), null);
  assert.equal(symbolFromCurrencyToken('   '), null);
  assert.equal(symbolFromCurrencyToken(null), null);
  assert.equal(symbolFromCurrencyToken(undefined), null);
  // A ₪ that lost its encoding somewhere upstream. Unknown, so the id gets a chance to speak.
  assert.equal(symbolFromCurrencyToken('?'), null);
});

test('a real currency token still maps to its symbol', () => {
  assert.equal(symbolFromCurrencyToken('USD'), '$');
  assert.equal(symbolFromCurrencyToken('$'), '$');
  assert.equal(symbolFromCurrencyToken('usd'), '$');
  assert.equal(symbolFromCurrencyToken('ILS'), '₪');
  assert.equal(symbolFromCurrencyToken('NIS'), '₪');
  assert.equal(symbolFromCurrencyToken('EUR'), '€');
  assert.equal(symbolFromCurrencyToken('GBP'), '£');
});

test('mapLeadCurrencyToSymbol still falls back to shekels for its existing callers', () => {
  assert.equal(mapLeadCurrencyToSymbol(''), '₪');
  assert.equal(mapLeadCurrencyToSymbol(null), '₪');
  assert.equal(mapLeadCurrencyToSymbol('?'), '₪');
  assert.equal(mapLeadCurrencyToSymbol('USD'), '$');
  // An unrecognised code is passed through rather than replaced.
  assert.equal(mapLeadCurrencyToSymbol('CHF'), 'CHF');
});

test('picking a token skips blanks instead of stopping on them like ?? does', () => {
  assert.equal(pickCurrencyToken('', 'USD'), 'USD');
  assert.equal(pickCurrencyToken('   ', null, '$'), '$');
  assert.equal(pickCurrencyToken(null, undefined), null);
  assert.equal(pickCurrencyToken('USD', 'ILS'), 'USD');
});

test('picking an id skips blanks and non-positive values', () => {
  assert.equal(pickCurrencyId('', USD_ID), USD_ID);
  assert.equal(pickCurrencyId(0, USD_ID), USD_ID);
  assert.equal(pickCurrencyId(null, undefined), null);
  assert.equal(pickCurrencyId('3'), USD_ID);
  assert.equal(pickCurrencyId(NIS_ID, USD_ID), NIS_ID);
});

test('a currency_id alone resolves to its symbol', () => {
  // The headline regression: proformaDisplayCurrency({ currency_id }) returned ₪ for every id,
  // because the id was dropped whenever no accounting_currencies list was passed in.
  assert.equal(proformaDisplayCurrency({ currency_id: USD_ID }), '$');
  assert.equal(proformaDisplayCurrency({ currency_id: NIS_ID }), '₪');
  assert.equal(proformaDisplayCurrency({ currency_id: 2 }), '€');
  assert.equal(proformaDisplayCurrency({ currency_id: 4 }), '£');
});

test('a blank currency token falls through to the id rather than to shekels', () => {
  assert.equal(proformaDisplayCurrency({ currency: '', currency_id: USD_ID }), '$');
  assert.equal(proformaDisplayCurrency({ currency: null, currency_id: USD_ID }), '$');
  assert.equal(proformaDisplayCurrency({ currency: '?', currency_id: USD_ID }), '$');
  assert.equal(displaySymbolForPaymentSave({ currency: '', currency_id: USD_ID }), '$');
});

test('the save path still lets a freshly picked token win over a stale id', () => {
  // Switching a payment from ₪ to $ in the UI sends the new token with the old currency_id still
  // attached. The token has to win or the edit silently reverts.
  assert.equal(displaySymbolForPaymentSave({ currency: '$', currency_id: NIS_ID }), '$');
  assert.equal(displaySymbolForPaymentSave({ currency: '₪', currency_id: USD_ID }), '₪');
});

test('resolveProformaCurrency trusts the id over a contradicting token', async () => {
  // get_public_legacy_proforma used to return COALESCE(iso_code, 'ILS'), so an unresolved currency
  // arrived as a confident 'ILS' beside the real id.
  const resolved = await resolveProformaCurrency({ currency: 'ILS', currency_id: USD_ID });
  assert.equal(resolved.displaySymbol, '$');
  assert.equal(resolved.currencyId, USD_ID);
});

test('resolveProformaCurrency handles a blank token beside a real id', async () => {
  for (const currency of ['', '   ', null, undefined, '?']) {
    const resolved = await resolveProformaCurrency({ currency, currency_id: USD_ID });
    assert.equal(resolved.displaySymbol, '$', `blank token ${JSON.stringify(currency)}`);
    assert.equal(resolved.currencyId, USD_ID);
  }
});

test('resolveProformaCurrency uses the token when there is no id', async () => {
  const resolved = await resolveProformaCurrency({ currency: 'USD', currency_id: null });
  assert.equal(resolved.displaySymbol, '$');
  assert.equal(resolved.currencyId, USD_ID);
});

test('resolveProformaCurrency keeps shekels when shekels are what the row says', async () => {
  const byId = await resolveProformaCurrency({ currency: null, currency_id: NIS_ID });
  assert.equal(byId.displaySymbol, '₪');
  const byToken = await resolveProformaCurrency({ currency: 'ILS', currency_id: null });
  assert.equal(byToken.displaySymbol, '₪');
});

test('a blank payment currency does not stop the proforma currency being read', () => {
  // normalizeProformaCurrencyFields is the last writer before render, so a wrong answer here undoes
  // whatever the page resolved.
  const normalized = normalizeProformaCurrencyFields(
    { currency: '$', currency_id: USD_ID },
    { currency: '', currency_id: null },
  );
  assert.equal(normalized.currency, '$');
  assert.equal(normalized.currency_code, '$');
  assert.equal(normalized.currency_id, USD_ID);
});

test('the live payment currency still overrides the proforma snapshot', () => {
  const normalized = normalizeProformaCurrencyFields(
    { currency: '₪', currency_id: NIS_ID },
    { currency: '$', currency_id: USD_ID },
  );
  assert.equal(normalized.currency, '$');
  assert.equal(normalized.currency_id, USD_ID);
});
