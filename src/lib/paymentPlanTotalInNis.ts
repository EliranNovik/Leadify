import type { CurrencyInput } from './boiCurrencyConversion';
import { isExpenseNoVatPayment } from './proformaVat';
import {
  currencyInputFromLegacyProforma,
  currencyInputFromNewPayment,
  fetchPaymentPlanExchangeContexts,
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
 * Sum payment-plan rows in NIS using the same rules as proforma / PaymentPage:
 * locked BOI charge when Pelecard session exists; unpaid → BOI today; paid → payment-date rate.
 */
async function sumFilteredPaymentPlanTotalsInNis(
  payments: PaymentPlanRowLike[],
  includePayment: (payment: PaymentPlanRowLike) => boolean,
): Promise<PaymentPlanTotalsInNis> {
  let subtotalNis = 0;
  let vatNis = 0;

  const eligiblePayments = payments.filter(includePayment);

  const planIds = eligiblePayments
    .map((p) => (typeof p.id === 'number' ? p.id : parseInt(String(p.id), 10)))
    .filter((id) => Number.isFinite(id));
  const exchangeContexts = await fetchPaymentPlanExchangeContexts(planIds);

  for (const payment of eligiblePayments) {
    const subtotal = Number(payment.value) || 0;
    const vat = Number(payment.valueVat) || 0;
    const total = subtotal + vat;
    if (total <= 0 && subtotal <= 0) continue;

    const planId =
      typeof payment.id === 'number' ? payment.id : parseInt(String(payment.id), 10);

    const info = await fetchProformaExchangeRateInfo({
      currency: resolvePaymentRowCurrencyInput(payment),
      paid: !!payment.paid,
      paidAt: payment.paid_at ?? null,
      subtotal,
      vat,
      total,
      paymentPlanId: Number.isFinite(planId) ? planId : null,
      preloadedExchangeContext: Number.isFinite(planId)
        ? exchangeContexts.get(planId) ?? null
        : null,
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

export async function sumPaymentPlanTotalsInNis(
  payments: PaymentPlanRowLike[],
): Promise<PaymentPlanTotalsInNis> {
  return sumFilteredPaymentPlanTotalsInNis(
    payments,
    (p) => !isExpenseNoVatPayment(p.order),
  );
}

/** All rows, including client and office expenses. */
export async function sumAllPaymentPlanTotalsInNis(
  payments: PaymentPlanRowLike[],
): Promise<PaymentPlanTotalsInNis> {
  return sumFilteredPaymentPlanTotalsInNis(payments, () => true);
}

export async function sumExpenseNoVatPlanTotalsInNis(
  payments: PaymentPlanRowLike[],
): Promise<PaymentPlanTotalsInNis> {
  // Client-paid (or unset) expenses only — shown as + under contract; never inflate contract total.
  // Firm-paid expenses reduce lead total separately and are excluded here.
  return sumFilteredPaymentPlanTotalsInNis(
    payments,
    (p) => isExpenseNoVatPayment(p.order) && p.expensePaidBy !== 'firm',
  );
}

function emptyNisTotals(): PaymentPlanTotalsInNis {
  return { subtotalNis: 0, vatNis: 0, totalNis: 0 };
}

function addNisTotals(target: PaymentPlanTotalsInNis, subtotalNis: number, vatNis: number) {
  target.subtotalNis += subtotalNis;
  target.vatNis += vatNis;
  target.totalNis += subtotalNis + vatNis;
}

function roundNisTotals(totals: PaymentPlanTotalsInNis): PaymentPlanTotalsInNis {
  return {
    subtotalNis: Math.round(totals.subtotalNis),
    vatNis: Math.round(totals.vatNis),
    totalNis: Math.round(totals.totalNis),
  };
}

/** Contact header: payments + client expenses in `total`; office-paid expenses kept separate. */
export async function sumContactPlanHeaderTotalsInNis(
  payments: PaymentPlanRowLike[],
): Promise<{ total: PaymentPlanTotalsInNis; office: PaymentPlanTotalsInNis }> {
  const plan = emptyNisTotals();
  const clientExpense = emptyNisTotals();
  const office = emptyNisTotals();

  const eligiblePayments = payments.filter((payment) => {
    const subtotal = Number(payment.value) || 0;
    const vat = Number(payment.valueVat) || 0;
    return subtotal > 0 || vat > 0 || subtotal + vat > 0;
  });

  const planIds = eligiblePayments
    .map((p) => (typeof p.id === 'number' ? p.id : parseInt(String(p.id), 10)))
    .filter((id) => Number.isFinite(id));
  const exchangeContexts = await fetchPaymentPlanExchangeContexts(planIds);

  for (const payment of eligiblePayments) {
    const subtotal = Number(payment.value) || 0;
    const vat = Number(payment.valueVat) || 0;
    const total = subtotal + vat;
    const planId =
      typeof payment.id === 'number' ? payment.id : parseInt(String(payment.id), 10);

    const info = await fetchProformaExchangeRateInfo({
      currency: resolvePaymentRowCurrencyInput(payment),
      paid: !!payment.paid,
      paidAt: payment.paid_at ?? null,
      subtotal,
      vat,
      total,
      paymentPlanId: Number.isFinite(planId) ? planId : null,
      preloadedExchangeContext: Number.isFinite(planId)
        ? exchangeContexts.get(planId) ?? null
        : null,
    });
    if (!info) continue;

    if (!isExpenseNoVatPayment(payment.order)) {
      addNisTotals(plan, info.subtotalNis, info.vatNis);
    } else if (payment.expensePaidBy === 'firm') {
      addNisTotals(office, info.subtotalNis, info.vatNis);
    } else {
      addNisTotals(clientExpense, info.subtotalNis, info.vatNis);
    }
  }

  return {
    total: roundNisTotals({
      subtotalNis: plan.subtotalNis + clientExpense.subtotalNis,
      vatNis: plan.vatNis + clientExpense.vatNis,
      totalNis: plan.totalNis + clientExpense.totalNis,
    }),
    office: roundNisTotals(office),
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

export function formatExpenseNoVatNisDisplay(totals: PaymentPlanTotalsInNis): string | undefined {
  if (totals.totalNis <= 0 && totals.subtotalNis <= 0) return undefined;
  return formatIlsAmount(totals.totalNis);
}
