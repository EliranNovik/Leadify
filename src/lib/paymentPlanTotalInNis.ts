import type { CurrencyInput } from './boiCurrencyConversion';
import {
  currencyInputFromLegacyProforma,
  currencyInputFromNewPayment,
  fetchProformaExchangeRateInfo,
  formatIlsAmount,
} from './proformaExchangeRate';
import type { PaymentPlanRowLike } from '../components/client-tabs/paymentPlanUi';

export type PaymentPlanTotalsInNis = {
  subtotalNis: number;
  vatNis: number;
  totalNis: number;
};

function resolvePaymentRowCurrencyInput(payment: PaymentPlanRowLike): CurrencyInput {
  if (payment.currency_id != null && payment.currency_id !== '') {
    return payment.currency_id;
  }
  if (payment.isLegacy) {
    return currencyInputFromLegacyProforma({
      currency_id: payment.currency_id ?? null,
      currency_code: payment.currency ?? null,
    });
  }
  return currencyInputFromNewPayment(
    { currency: payment.currency, currency_id: payment.currency_id ?? null },
    payment.currency,
  );
}

/**
 * Sum payment-plan rows in NIS using the same rules as proforma / ClientHeader conversion:
 * unpaid → BOI today; paid → legacy rate on payment date.
 */
export async function sumPaymentPlanTotalsInNis(
  payments: PaymentPlanRowLike[],
): Promise<PaymentPlanTotalsInNis> {
  let subtotalNis = 0;
  let vatNis = 0;

  for (const payment of payments) {
    const subtotal = Number(payment.value) || 0;
    const vat = Number(payment.valueVat) || 0;
    const total = subtotal + vat;
    if (total <= 0 && subtotal <= 0) continue;

    const info = await fetchProformaExchangeRateInfo({
      currency: resolvePaymentRowCurrencyInput(payment),
      paid: !!payment.paid,
      paidAt: payment.paid_at ?? null,
      subtotal,
      vat,
      total,
    });

    if (!info) continue;
    subtotalNis += info.subtotalNis;
    vatNis += info.vatNis;
  }

  const totalNis = subtotalNis + vatNis;
  return {
    subtotalNis: Math.round(subtotalNis),
    vatNis: Math.round(vatNis),
    totalNis: Math.round(totalNis),
  };
}

export function formatOutstandingNisDisplay(totals: PaymentPlanTotalsInNis): {
  primary: string;
} {
  if (totals.totalNis <= 0 && totals.subtotalNis <= 0) {
    return { primary: '—' };
  }
  return { primary: formatIlsAmount(totals.totalNis) };
}

export function formatContractTotalNisDisplay(totals: PaymentPlanTotalsInNis): {
  primary: string;
  secondary?: string;
} {
  if (totals.totalNis <= 0 && totals.subtotalNis <= 0) {
    return { primary: '—' };
  }

  return {
    primary: formatIlsAmount(totals.subtotalNis),
    secondary:
      totals.vatNis > 0
        ? `+ ₪${totals.vatNis.toLocaleString(undefined, {
            minimumFractionDigits: 0,
            maximumFractionDigits: 2,
          })} VAT`
        : undefined,
  };
}
