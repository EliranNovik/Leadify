/**
 * Resolve display currency for payment plans / proformas (aligned with FinancesTab).
 */
import { buildCurrencyMetaFromId, loadAccountingCurrenciesMap } from './boiCurrencyConversion';
import { getCurrencySymbol } from './currencyConversion';

export function mapLeadCurrencyToSymbol(code?: string | null): string {
  if (!code) return '₪';
  const normalized = String(code).trim().toUpperCase();
  if (normalized === '₪' || normalized === 'NIS' || normalized === 'ILS') return '₪';
  if (normalized === '$' || normalized === 'USD') return '$';
  if (normalized === '€' || normalized === 'EUR') return '€';
  if (normalized === '£' || normalized === 'GBP') return '£';
  const trimmed = String(code).trim();
  return trimmed || '₪';
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
  return mapLeadCurrencyToSymbol(input.currency);
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
  const currency_id = resolveCurrencyIdForSave({
    currency: payment.currency ?? payment.currency_code ?? (proforma as { currency?: string }).currency
      ?? (proforma as { currency_code?: string }).currency_code,
    currency_id: payment.currency_id ?? (proforma as { currency_id?: number | string }).currency_id,
  });
  const display = displaySymbolForPaymentSave({
    currency: payment.currency ?? payment.currency_code ?? (proforma as { currency?: string }).currency
      ?? (proforma as { currency_code?: string }).currency_code,
    currency_id,
  });
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

/** Create/view proforma pages: always return display symbol + numeric currency_id. */
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
  const displaySymbol = displaySymbolForPaymentSave(
    {
      currency: input.currency ?? resolved.displaySymbol,
      currency_id: currencyId,
    },
    availableCurrencies,
  );
  return { displaySymbol, currencyId };
}
