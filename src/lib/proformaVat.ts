import { getVatRateForLegacyLead } from './legacyProformaVat';
import { parsePaymentPlanAmount } from './proformaPaymentPlanAmounts';
import { parseExplicitPaymentPlanVat } from './paymentPlanVat';

export { getVatRateForLegacyLead };

/** Matches FinancesTab — order 99 / "Expense (no VAT)". */
export function isExpenseNoVatPayment(order: number | string | null | undefined): boolean {
  if (order === 99 || order === '99') return true;
  if (typeof order === 'string') {
    const text = order.toLowerCase();
    return text.includes('expense') && text.includes('no vat');
  }
  return false;
}

/** Matches FinancesTab — VAT only on Israeli shekel (₪ / ILS / NIS or currency_id 1). */
export function isIsraeliShekelCurrency(
  currency: string | null | undefined,
  currencyId?: number | string | null,
): boolean {
  if (currencyId != null && currencyId !== '' && Number(currencyId) === 1) return true;
  if (!currency) return false;
  const c = String(currency).trim();
  return c === '₪' || c === 'ILS' || c === 'NIS';
}

export type ProformaVatInput = {
  currency?: string | null;
  currency_id?: number | string | null;
  valueVat?: number | string | null;
  paymentOrder?: number | string | null;
  dueDate?: string | null;
  subtotal: number;
};

/**
 * Derive addVat + amounts from payment plan (FinancesTab rules).
 * - Expense (no VAT): never add VAT.
 * - Stored value_vat / vat_value > 0: always show (any currency — matches FinancesTab totals).
 * - Otherwise auto-calculate VAT only for Israeli shekel (₪ / ILS / currency_id 1).
 */
export function computeProformaVatFromPayment({
  currency,
  currency_id,
  valueVat,
  paymentOrder,
  dueDate,
  subtotal,
}: ProformaVatInput) {
  const vatRate = getVatRateForLegacyLead(dueDate);
  const numericVat = Number(valueVat) || 0;

  if (isExpenseNoVatPayment(paymentOrder)) {
    return { addVat: false, vat: 0, vatRate, totalWithVat: subtotal };
  }

  if (numericVat > 0) {
    return {
      addVat: true,
      vat: numericVat,
      vatRate,
      totalWithVat: Math.round((subtotal + numericVat) * 100) / 100,
    };
  }

  const addVat = isIsraeliShekelCurrency(currency, currency_id);
  const vat = addVat ? Math.round(subtotal * vatRate * 100) / 100 : 0;
  const totalWithVat = addVat ? Math.round((subtotal + vat) * 100) / 100 : subtotal;

  return { addVat, vat, vatRate, totalWithVat };
}

export type ResolvedProformaVat = {
  subtotal: number;
  addVat: boolean;
  vat: number;
  totalWithVat: number;
  vatRate: number;
  vatPercentLabel: number;
};

export function getProformaSubtotal(proforma: {
  rows?: Array<{ total?: number | string }>;
  total?: number | string | null;
}): number {
  if (Array.isArray(proforma.rows) && proforma.rows.length > 0) {
    return proforma.rows.reduce((sum, row) => sum + (Number(row.total) || 0), 0);
  }
  return Number(proforma.total) || 0;
}

export type NewProformaPaymentVatSource = {
  currency?: string | null;
  currency_id?: number | string | null;
  value?: number | string | null;
  value_vat?: number | string | null;
  payment_order?: string | number | null;
  due_date?: string | null;
};

function pickPositiveAmount(...candidates: (number | string | null | undefined)[]): number {
  for (const candidate of candidates) {
    const n = Number(candidate);
    if (Number.isFinite(n) && n > 0) return n;
  }
  return 0;
}

function vatFromTotalDelta(subtotal: number, totalWithVat: number): number {
  if (totalWithVat > subtotal) {
    return Math.round((totalWithVat - subtotal) * 100) / 100;
  }
  return 0;
}

function finalizeResolvedVat(
  subtotal: number,
  computed: ReturnType<typeof computeProformaVatFromPayment>,
  storedVat: number,
): ResolvedProformaVat {
  const vatRate = computed.vatRate;
  if (!computed.addVat && storedVat > 0) {
    return {
      subtotal,
      addVat: true,
      vat: storedVat,
      totalWithVat: Math.round((subtotal + storedVat) * 100) / 100,
      vatRate,
      vatPercentLabel: Math.round(vatRate * 100),
    };
  }
  return {
    subtotal,
    addVat: computed.addVat,
    vat: computed.vat,
    totalWithVat: computed.totalWithVat,
    vatRate,
    vatPercentLabel: Math.round(vatRate * 100),
  };
}

function resolveVatFromExplicitPaymentPlan(
  subtotal: number,
  paymentOrder: string | number | null | undefined,
  dueDate: string | null | undefined,
  explicitVat: ReturnType<typeof parseExplicitPaymentPlanVat>,
): ResolvedProformaVat | null {
  if (!explicitVat.explicit) return null;

  const vatRate = getVatRateForLegacyLead(dueDate);
  if (isExpenseNoVatPayment(paymentOrder)) {
    return {
      subtotal,
      addVat: false,
      vat: 0,
      totalWithVat: subtotal,
      vatRate,
      vatPercentLabel: Math.round(vatRate * 100),
    };
  }

  return {
    subtotal,
    addVat: explicitVat.amount > 0,
    vat: explicitVat.amount,
    totalWithVat: Math.round((subtotal + explicitVat.amount) * 100) / 100,
    vatRate,
    vatPercentLabel: Math.round(vatRate * 100),
  };
}

export function resolveNewProformaVat(
  proforma: {
    rows?: Array<{ total?: number | string }>;
    total?: number | string | null;
    vat?: number | string | null;
    totalWithVat?: number | string | null;
    currency?: string | null;
    paymentOrder?: string | number | null;
    dueDate?: string | null;
  },
  payment: NewProformaPaymentVatSource,
): ResolvedProformaVat {
  const subtotalFromPlan = parsePaymentPlanAmount(payment.value);
  const subtotal = subtotalFromPlan ?? getProformaSubtotal(proforma);
  const paymentOrder = payment.payment_order ?? proforma.paymentOrder;
  const dueDate = payment.due_date ?? proforma.dueDate;

  const explicitResolved = resolveVatFromExplicitPaymentPlan(
    subtotal,
    paymentOrder,
    dueDate,
    parseExplicitPaymentPlanVat(payment.value_vat),
  );
  if (explicitResolved) return explicitResolved;

  const storedVat = pickPositiveAmount(
    proforma.vat,
    vatFromTotalDelta(subtotal, Number(proforma.totalWithVat) || 0),
  );
  const computed = computeProformaVatFromPayment({
    currency: payment.currency ?? proforma.currency ?? '₪',
    currency_id: payment.currency_id,
    valueVat: storedVat,
    paymentOrder,
    dueDate,
    subtotal,
  });
  return finalizeResolvedVat(subtotal, computed, storedVat);
}

/** Map legacy ISO currency code to display symbol for VAT checks. */
export function legacyProformaCurrencyForVat(currencyCode: string | null | undefined): string {
  const code = String(currencyCode || 'ILS').trim().toUpperCase();
  if (code === 'ILS' || code === 'NIS') return '₪';
  if (code === 'USD') return '$';
  if (code === 'EUR') return '€';
  if (code === 'GBP') return '£';
  return code;
}

export function getLegacyProformaSubtotal(proforma: {
  rows?: Array<{ total?: number | string }>;
  sub_total?: number | string | null;
  total_base?: number | string | null;
}): number {
  if (Array.isArray(proforma.rows) && proforma.rows.length > 0) {
    const fromRows = proforma.rows.reduce((sum, row) => sum + (Number(row.total) || 0), 0);
    if (fromRows > 0) return fromRows;
  }
  return Number(proforma.sub_total ?? proforma.total_base ?? 0) || 0;
}

export function resolveLegacyProformaVat(
  proforma: {
    rows?: Array<{ total?: number | string }>;
    currency_code?: string | null;
    vat_value?: number | string | null;
    sub_total?: number | string | null;
    total_base?: number | string | null;
    total?: number | string | null;
    add_vat?: string | boolean | null;
    paymentPlanDate?: string | null;
    cdate?: string | null;
    paymentOrder?: string | number | null;
  },
  paymentRow?: {
    order?: string | number | null;
    value?: number | string | null;
    vat_value?: number | string | null;
  } | null,
): ResolvedProformaVat {
  const subtotalFromPlan = parsePaymentPlanAmount(paymentRow?.value);
  const subtotal = subtotalFromPlan ?? getLegacyProformaSubtotal(proforma);
  const paymentOrder = paymentRow?.order ?? proforma.paymentOrder;
  const dueDate = proforma.paymentPlanDate ?? proforma.cdate;

  const explicitResolved = resolveVatFromExplicitPaymentPlan(
    subtotal,
    paymentOrder,
    dueDate,
    parseExplicitPaymentPlanVat(paymentRow?.vat_value),
  );
  if (explicitResolved) return explicitResolved;

  const storedVat = pickPositiveAmount(
    proforma.vat_value,
    vatFromTotalDelta(subtotal, Number(proforma.total) || 0),
  );
  const computed = computeProformaVatFromPayment({
    currency: legacyProformaCurrencyForVat(proforma.currency_code),
    currency_id: (proforma as { currency_id?: number | string | null }).currency_id,
    valueVat: storedVat,
    paymentOrder,
    dueDate,
    subtotal,
  });
  return finalizeResolvedVat(subtotal, computed, storedVat);
}

/** Apply resolved VAT onto a new-lead proforma object for view/display. */
export function applyResolvedVatToNewProforma<T extends Record<string, unknown>>(
  proforma: T,
  resolved: ResolvedProformaVat,
): T {
  return {
    ...proforma,
    total: resolved.subtotal,
    addVat: resolved.addVat,
    vat: resolved.vat,
    totalWithVat: resolved.totalWithVat,
  };
}
