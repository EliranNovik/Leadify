/**
 * Resolve display currency for payment plans / proformas (aligned with FinancesTab).
 */
import { buildCurrencyMetaFromId, getCurrencySymbol, loadAccountingCurrenciesMap } from './boiCurrencyConversion';

/**
 * Symbol for a currency token, or null when the token tells us nothing.
 *
 * Blank, whitespace and `'?'` (a ₪ that lost its encoding on the way through some older column) all
 * mean *unknown* — not shekels. Callers that also hold a `currency_id` have to be able to tell the
 * difference, otherwise an empty token silently stamps ₪ onto a dollar amount.
 */
export function symbolFromCurrencyToken(code?: string | null): string | null {
  const trimmed = String(code ?? '').trim();
  if (!trimmed || trimmed === '?') return null;
  const normalized = trimmed.toUpperCase();
  if (normalized === '₪' || normalized === 'NIS' || normalized === 'ILS') return '₪';
  if (normalized === '$' || normalized === 'USD') return '$';
  if (normalized === '€' || normalized === 'EUR') return '€';
  if (normalized === '£' || normalized === 'GBP') return '£';
  return trimmed;
}

/** Symbol for an `accounting_currencies` id, or null when there is no usable id to read. */
export function symbolFromCurrencyId(currencyId?: number | string | null): string | null {
  const id = pickCurrencyId(currencyId);
  if (id == null) return null;
  return getCurrencySymbol(id) || null;
}

/**
 * First token that actually names a currency.
 *
 * Unlike `??`, this skips `''`: a cleared text column arrives as an empty string, which `??` treats
 * as a real value and stops on — so the next, populated source never gets consulted.
 */
export function pickCurrencyToken(...tokens: Array<string | null | undefined>): string | null {
  for (const token of tokens) {
    if (String(token ?? '').trim() !== '') return String(token);
  }
  return null;
}

/** First usable `accounting_currencies` id, skipping null, `''` and non-positive values. */
export function pickCurrencyId(...ids: Array<number | string | null | undefined>): number | null {
  for (const raw of ids) {
    if (raw == null || String(raw).trim() === '') continue;
    const id = Number(raw);
    if (Number.isFinite(id) && id > 0) return id;
  }
  return null;
}

export function mapLeadCurrencyToSymbol(code?: string | null): string {
  return symbolFromCurrencyToken(code) ?? '₪';
}

export type PaymentPlanCurrencyInput = {
  currency?: string | null;
  currency_id?: number | string | null;
  lead_currency_id?: number | string | null;
  proposal_currency?: string | null;
  balance_currency?: string | null;
};

export type ResolvedPaymentPlanCurrency = {
  displaySymbol: string;
  currencyId: number | null;
};

export type AccountingCurrencyRow = { id: number; name: string; iso_code: string };

export function normalizeCurrencyToken(currency: string | null | undefined): string {
  return String(currency ?? '').trim().toUpperCase();
}

/** True when currency is Israeli shekel (by id or name/code/symbol). */
export function isNisCurrency(input: {
  currency?: string | null;
  currency_id?: number | string | null;
  currencyId?: number | string | null;
}): boolean {
  const rawId = input.currencyId ?? input.currency_id;
  if (rawId != null) {
    const id = Number(rawId);
    if (Number.isFinite(id) && id === 1) return true;
  }
  return mapLeadCurrencyToSymbol(input.currency) === '₪';
}

export function findAccountingCurrency(
  token: string | null | undefined,
  currencyId: number | string | null | undefined,
  availableCurrencies: AccountingCurrencyRow[] | undefined,
): AccountingCurrencyRow | undefined {
  if (!availableCurrencies?.length) return undefined;
  if (currencyId != null) {
    const id = Number(currencyId);
    if (Number.isFinite(id)) {
      const byId = availableCurrencies.find((c) => Number(c.id) === id);
      if (byId) return byId;
    }
  }
  const trimmed = String(token ?? '').trim();
  if (!trimmed) return undefined;
  const normalized = normalizeCurrencyToken(trimmed);
  const mapped = mapLeadCurrencyToSymbol(trimmed);
  return availableCurrencies.find((c) => {
    if (c.name === trimmed || c.iso_code === trimmed) return true;
    if (normalizeCurrencyToken(c.name) === normalized) return true;
    if (normalizeCurrencyToken(c.iso_code) === normalized) return true;
    return mapLeadCurrencyToSymbol(c.name) === mapped || mapLeadCurrencyToSymbol(c.iso_code) === mapped;
  });
}

/** FinancesTab currency_id mapping (accounting_currencies). */
export function currencyIdFromSymbol(currency: string | null | undefined): number {
  switch (mapLeadCurrencyToSymbol(currency)) {
    case '€':
      return 2;
    case '$':
      return 3;
    case '£':
      return 4;
    case '₪':
    default:
      return 1;
  }
}

export function resolveCurrencyIdForSave(
  input: {
    currency?: string | null;
    currencyId?: number | string | null;
    currency_id?: number | string | null;
  },
  availableCurrencies?: AccountingCurrencyRow[],
): number {
  const explicitId = input.currencyId ?? input.currency_id;
  if (explicitId != null) {
    const id = Number(explicitId);
    if (Number.isFinite(id) && id > 0) return id;
  }
  const match = findAccountingCurrency(input.currency, null, availableCurrencies);
  if (match?.id) return Number(match.id);
  return currencyIdFromSymbol(input.currency);
}

/** Display symbol (₪, $, …) for payment_plans.currency — not accounting name (NIS). */
export function displaySymbolForPaymentSave(
  input: {
    currency?: string | null;
    currencyId?: number | string | null;
    currency_id?: number | string | null;
  },
  availableCurrencies?: AccountingCurrencyRow[],
): string {
  const id = resolveCurrencyIdForSave(input, availableCurrencies);
  const match = findAccountingCurrency(input.currency, id, availableCurrencies);
  if (match) return mapLeadCurrencyToSymbol(match.iso_code || match.name);
  // Token first: this is the save path, so the token is the currency the user just picked.
  const fromToken = symbolFromCurrencyToken(input.currency);
  if (fromToken) return fromToken;
  // Token said nothing, so read the id the row stores. Without this the id was dropped entirely
  // whenever `availableCurrencies` was not supplied — which is every proforma page — and a USD plan
  // rendered as ₪.
  return symbolFromCurrencyId(input.currencyId ?? input.currency_id) ?? '₪';
}

export function displaySymbolFromAccountingRow(
  row: { id?: number; name?: string; iso_code?: string } | null | undefined,
): string {
  if (!row) return '₪';
  return mapLeadCurrencyToSymbol(row.iso_code || row.name);
}

/** Invoice display label — prefers currency_id, maps NIS/ILS → ₪ (FinancesTab aligned). */
export function proformaDisplayCurrency(input: {
  currency?: string | null;
  currency_code?: string | null;
  currency_id?: number | string | null;
}): string {
  return displaySymbolForPaymentSave({
    currency: input.currency ?? input.currency_code,
    currency_id: input.currency_id,
  });
}

export function normalizeProformaCurrencyFields<T extends Record<string, unknown>>(
  proforma: T,
  payment: { currency?: string | null; currency_code?: string | null; currency_id?: number | string | null },
): T {
  // `pickCurrencyToken` rather than `??` so a blank token on the payment row does not stop the chain
  // before the proforma's own currency is consulted. This runs after the page has resolved the
  // currency, so it is the last writer before render — a wrong answer here undoes everything.
  const token = pickCurrencyToken(
    payment.currency,
    payment.currency_code,
    (proforma as { currency?: string }).currency,
    (proforma as { currency_code?: string }).currency_code,
  );
  const currency_id = resolveCurrencyIdForSave({
    currency: token,
    currency_id: pickCurrencyId(
      payment.currency_id,
      (proforma as { currency_id?: number | string }).currency_id,
    ),
  });
  const display = displaySymbolForPaymentSave({ currency: token, currency_id });
  return {
    ...proforma,
    currency: display,
    currency_code: display,
    currency_id,
  };
}

export async function resolvePaymentPlanCurrency(
  input: PaymentPlanCurrencyInput,
): Promise<ResolvedPaymentPlanCurrency> {
  await loadAccountingCurrenciesMap();

  // If the payment row explicitly has a currency_id, it must win — even when it's ILS (₪).
  // Otherwise leads with multiple contacts can accidentally inherit the lead/main-contact currency.
  if (input.currency_id != null && input.currency_id !== '') {
    const id =
      typeof input.currency_id === 'number' ? input.currency_id : parseInt(String(input.currency_id), 10);
    if (Number.isFinite(id) && id > 0) {
      const sym = getCurrencySymbol(id);
      return { displaySymbol: sym || '₪', currencyId: id };
    }
  }

  // If the payment row explicitly has a currency token (text/symbol/ISO), it must win — even when it maps to ₪.
  const token = String(input.currency ?? '').trim();
  if (token) {
    const sym = mapLeadCurrencyToSymbol(token);
    return { displaySymbol: sym, currencyId: currencyIdFromSymbol(sym) };
  }

  const meta = buildCurrencyMetaFromId(
    input.currency_id,
    input.currency,
    input.lead_currency_id,
    mapLeadCurrencyToSymbol(input.proposal_currency),
    mapLeadCurrencyToSymbol(input.balance_currency),
  );

  if (meta.displaySymbol && meta.displaySymbol !== '₪') {
    return { displaySymbol: meta.displaySymbol, currencyId: meta.currencyId };
  }

  const fromId = input.currency_id != null ? getCurrencySymbol(input.currency_id) : null;
  if (fromId && fromId !== '₪') {
    return {
      displaySymbol: fromId,
      currencyId:
        typeof input.currency_id === 'number'
          ? input.currency_id
          : parseInt(String(input.currency_id), 10) || null,
    };
  }

  const fromText = mapLeadCurrencyToSymbol(input.currency);
  if (fromText !== '₪') {
    return { displaySymbol: fromText, currencyId: currencyIdFromSymbol(fromText) };
  }

  const fromLead = input.lead_currency_id != null ? getCurrencySymbol(input.lead_currency_id) : null;
  if (fromLead && fromLead !== '₪') {
    const id =
      typeof input.lead_currency_id === 'number'
        ? input.lead_currency_id
        : parseInt(String(input.lead_currency_id), 10);
    return { displaySymbol: fromLead, currencyId: Number.isFinite(id) ? id : null };
  }

  return { displaySymbol: meta.displaySymbol || '₪', currencyId: meta.currencyId };
}

/**
 * Create/view proforma pages: always return display symbol + numeric currency_id.
 *
 * The id wins over the text token here. `currency_id` is a foreign key into
 * `accounting_currencies`, while the token is free text that turns up blank, mojibake'd as `'?'`, or
 * hard-coded to `'ILS'` by `get_public_legacy_proforma`'s `COALESCE(v_ac.iso_code, 'ILS')`. Each of
 * those used to beat a perfectly good id and print ₪ over a dollar amount.
 */
export async function resolveProformaCurrency(
  input: PaymentPlanCurrencyInput,
  availableCurrencies?: AccountingCurrencyRow[],
): Promise<ResolvedPaymentPlanCurrency> {
  const resolved = await resolvePaymentPlanCurrency(input);
  const currencyId = resolveCurrencyIdForSave(
    {
      currency: input.currency,
      currency_id: resolved.currencyId ?? input.currency_id,
    },
    availableCurrencies,
  );
  // Only ids we were actually given count. `currencyId` above falls back to 1 (₪) for an unknown
  // currency, so trusting it unconditionally would reinstate the very default this guards against.
  const knownId = pickCurrencyId(input.currency_id, resolved.currencyId);
  const fromKnownId = knownId != null
    ? displaySymbolForPaymentSave({ currency: null, currency_id: knownId }, availableCurrencies)
    : null;
  const displaySymbol =
    fromKnownId ?? symbolFromCurrencyToken(input.currency) ?? resolved.displaySymbol;
  return { displaySymbol, currencyId };
}
