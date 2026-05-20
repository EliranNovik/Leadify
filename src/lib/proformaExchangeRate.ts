/**
 * Proforma invoices: exchange rates for display and NIS equivalents.
 * Unpaid → today's BOI rate (Jerusalem).
 * Paid → legacy currency_rates effective on or before payment date.
 */
import {
  type BoiRatesSnapshot,
  type CurrencyInput,
  buildCurrencyMetaFromId,
  convertToNISWithMeta,
  getJerusalemTodayIsoDate,
  isLocalCurrency,
  loadAccountingCurrenciesMap,
  loadBoiExchangeRates,
  loadBoiExchangeRatesForDate,
  resolveCurrencyIsoCode,
} from './boiCurrencyConversion';
import {
  convertAmountWithLegacyRate,
  loadLatestLegacyCurrencyRate,
  loadLegacyCurrencyRateForPaymentDate,
} from './legacyCurrencyRates';

export type ProformaExchangeRateLabel = 'today' | 'payment_date';
export type ProformaRateSource = 'boi' | 'legacy';

export type ProformaExchangeRateInfo = {
  isoCode: string;
  displaySymbol: string;
  rateToIls: number;
  /** Publication / effective date used for the rate */
  rateDate: string;
  rateLabel: ProformaExchangeRateLabel;
  rateSource: ProformaRateSource;
  isLocalCurrency: boolean;
  paid: boolean;
  paidAt: string | null;
  subtotalNis: number;
  vatNis: number;
  totalNis: number;
  usedLegacyFallback: boolean;
};

export type FetchProformaExchangeRateParams = {
  currency: CurrencyInput;
  paid?: boolean;
  paidAt?: string | null;
  subtotal: number;
  vat?: number;
  total: number;
};

function toDateOnly(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const d = iso.slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(d) ? d : null;
}

export async function fetchProformaExchangeRateInfo(
  params: FetchProformaExchangeRateParams,
): Promise<ProformaExchangeRateInfo | null> {
  const { currency, paid = false, paidAt = null, subtotal, vat = 0, total } = params;

  // Resolve currency_id → ISO before local-currency / BOI lookups (map is sync after await).
  await loadAccountingCurrenciesMap();

  const meta = buildCurrencyMetaFromId(currency);
  const isoCode = meta.isoCode;

  if (isLocalCurrency(isoCode)) {
    return {
      isoCode: 'ILS',
      displaySymbol: '₪',
      rateToIls: 1,
      rateDate: getJerusalemTodayIsoDate(),
      rateLabel: paid && paidAt ? 'payment_date' : 'today',
      rateSource: 'legacy',
      isLocalCurrency: true,
      paid,
      paidAt,
      subtotalNis: subtotal,
      vatNis: vat,
      totalNis: total,
      usedLegacyFallback: false,
    };
  }

  const payDate = paid && paidAt ? toDateOnly(paidAt) : null;

  if (paid) {
    const legacyRate = payDate
      ? await loadLegacyCurrencyRateForPaymentDate(currency, payDate)
      : await loadLatestLegacyCurrencyRate(currency);

    return {
      isoCode,
      displaySymbol: meta.displaySymbol,
      rateToIls: legacyRate.rateToIls,
      rateDate: legacyRate.effectiveDate,
      rateLabel: payDate ? 'payment_date' : 'today',
      rateSource: 'legacy',
      isLocalCurrency: false,
      paid,
      paidAt: payDate,
      subtotalNis: convertAmountWithLegacyRate(subtotal, legacyRate),
      vatNis: convertAmountWithLegacyRate(vat, legacyRate),
      totalNis: convertAmountWithLegacyRate(total, legacyRate),
      usedLegacyFallback: legacyRate.usedFallback,
    };
  }

  const conv = await convertUnpaidToNisBoiToday(currency, subtotal, vat);

  return {
    isoCode,
    displaySymbol: meta.displaySymbol,
    rateToIls: conv.rateToIls,
    rateDate: conv.rateDate,
    rateLabel: 'today',
    rateSource: 'boi',
    isLocalCurrency: conv.isLocalCurrency,
    paid,
    paidAt: null,
    subtotalNis: conv.subtotalNis,
    vatNis: conv.vatNis,
    totalNis: conv.totalNis,
    usedLegacyFallback: conv.usedLegacyFallback,
  };
}

/**
 * Unpaid amounts only — always BOI (today in Jerusalem), never legacy currency_rates.
 */
export async function convertUnpaidToNisBoiToday(
  currency: CurrencyInput,
  subtotal: number,
  vat = 0,
  preloadedSnapshot?: BoiRatesSnapshot,
): Promise<{
  subtotalNis: number;
  vatNis: number;
  totalNis: number;
  rateToIls: number;
  rateDate: string;
  usedLegacyFallback: boolean;
  isLocalCurrency: boolean;
}> {
  await loadAccountingCurrenciesMap();
  const meta = buildCurrencyMetaFromId(currency);
  const total = subtotal + vat;

  if (isLocalCurrency(meta.isoCode)) {
    return {
      subtotalNis: subtotal,
      vatNis: vat,
      totalNis: total,
      rateToIls: 1,
      rateDate: getJerusalemTodayIsoDate(),
      usedLegacyFallback: false,
      isLocalCurrency: true,
    };
  }

  const today = getJerusalemTodayIsoDate();
  let snap = preloadedSnapshot ?? (await loadBoiExchangeRatesForDate(today));
  let subConv = convertToNISWithMeta(subtotal, currency, snap);
  let vatConv = convertToNISWithMeta(vat, currency, snap);
  let totalConv = convertToNISWithMeta(total, currency, snap);

  if (subConv.usedLegacyFallback || vatConv.usedLegacyFallback || totalConv.usedLegacyFallback) {
    snap = await loadBoiExchangeRates(true);
    subConv = convertToNISWithMeta(subtotal, currency, snap);
    vatConv = convertToNISWithMeta(vat, currency, snap);
    totalConv = convertToNISWithMeta(total, currency, snap);
  }

  return {
    subtotalNis: subConv.amountNIS,
    vatNis: vatConv.amountNIS,
    totalNis: totalConv.amountNIS,
    rateToIls: subConv.rate,
    rateDate: snap.rateDate,
    usedLegacyFallback:
      subConv.usedLegacyFallback || vatConv.usedLegacyFallback || totalConv.usedLegacyFallback,
    isLocalCurrency: false,
  };
}

export function formatProformaRateDate(isoDate: string): string {
  try {
    return new Date(`${isoDate}T12:00:00`).toLocaleDateString(undefined, { dateStyle: 'medium' });
  } catch {
    return isoDate;
  }
}

export function formatIlsAmount(amount: number): string {
  return `₪${Math.round(amount).toLocaleString('en-US', { maximumFractionDigits: 0 })}`;
}

/** Human-readable lines for the invoice footer */
export function buildProformaExchangeFooterLines(info: ProformaExchangeRateInfo): string[] {
  if (info.isLocalCurrency) {
    return [];
  }

  const rateStr = info.rateToIls.toLocaleString(undefined, {
    minimumFractionDigits: 4,
    maximumFractionDigits: 4,
  });
  const rateDateFmt = formatProformaRateDate(info.rateDate);

  const lines: string[] = [];

  if (info.rateSource === 'legacy' && info.rateLabel === 'payment_date' && info.paidAt) {
    lines.push(`Exchange rate on payment date ${formatProformaRateDate(info.paidAt)}:`);
  } else if (info.rateSource === 'boi') {
    lines.push(`Representative exchange rate (Bank of Israel) for today — BOI rate date ${rateDateFmt}:`);
  } else {
    lines.push('Exchange rate:');
  }

  lines.push(`1 ${info.isoCode} = ${rateStr} ₪`);

  return lines;
}

/** Resolve currency input from new-lead payment plan + proforma JSON */
export function currencyInputFromNewPayment(
  payment: { currency?: string | null; currency_id?: number | string | null },
  proformaCurrency?: string | null,
): CurrencyInput {
  if (payment.currency_id != null) return payment.currency_id;
  return proformaCurrency || payment.currency || '₪';
}

/** Resolve currency input from legacy proforma row */
export function currencyInputFromLegacyProforma(proforma: {
  currency_id?: number | string | null;
  currency_code?: string | null;
}): CurrencyInput {
  if (proforma.currency_id != null) return proforma.currency_id;
  return resolveCurrencyIsoCode(proforma.currency_code || '₪');
}
