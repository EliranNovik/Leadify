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

/** FinancesTab currency_id mapping (accounting_currencies). */
export function currencyIdFromSymbol(currency: string | null | undefined): number {
  switch (currency?.trim()) {
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
