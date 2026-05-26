/** Line items + totals on proforma views follow payment plan row value (FinancesTab source of truth). */

import {
  applyResolvedVatToNewProforma,
  resolveLegacyProformaVat,
  resolveNewProformaVat,
  type ResolvedProformaVat,
} from './proformaVat';
import { normalizeProformaCurrencyFields } from './paymentPlanCurrency';

export type ProformaLineRow = {
  description?: string;
  qty?: number | string;
  rate?: number | string;
  total?: number | string;
};

export function parsePaymentPlanAmount(value: number | string | null | undefined): number | null {
  if (value == null || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

/** Align invoice line items with finances payment plan `value` (same as FinancesTab row amount). */
export function syncProformaLineItemsWithPaymentValue<
  T extends { rows?: ProformaLineRow[]; total?: number | string | null; sub_total?: number | string | null; total_base?: number | string | null },
>(proforma: T, paymentPlanValue: number | string | null | undefined): T {
  const amount = parsePaymentPlanAmount(paymentPlanValue);
  if (amount == null) return proforma;

  const rows = Array.isArray(proforma.rows) ? proforma.rows.map((row) => ({ ...row })) : [];
  if (rows.length === 0) {
    return {
      ...proforma,
      rows: [{ qty: 1, rate: amount, total: amount }],
      total: amount,
      sub_total: amount,
      total_base: amount,
    };
  }

  const first = { ...rows[0] };
  const qty = Number(first.qty) || 1;
  first.rate = amount;
  first.total = amount;
  first.qty = qty;
  rows[0] = first;

  return {
    ...proforma,
    rows,
    total: amount,
    sub_total: amount,
    total_base: amount,
  };
}

export type NewProformaPaymentPlanSnapshot = {
  value?: number | string | null;
  value_vat?: number | string | null;
  currency?: string | null;
  currency_id?: number | string | null;
  payment_order?: string | number | null;
  due_date?: string | null;
};

/** Merge frozen proforma JSON with live payment_plans amounts for display. */
export function applyNewPaymentPlanAmountsToProforma<T extends Record<string, unknown>>(
  proforma: T,
  payment: NewProformaPaymentPlanSnapshot,
): { proforma: T; vatTotals: ResolvedProformaVat } {
  const synced = syncProformaLineItemsWithPaymentValue(proforma, payment.value);
  const vatTotals = resolveNewProformaVat(synced, {
    currency: payment.currency ?? (synced as { currency?: string }).currency,
    currency_id: payment.currency_id,
    value: payment.value,
    value_vat: payment.value_vat,
    payment_order: payment.payment_order ?? (synced as { paymentOrder?: string | number }).paymentOrder,
    due_date: payment.due_date ?? (synced as { dueDate?: string }).dueDate,
  });
  return {
    proforma: normalizeProformaCurrencyFields(
      applyResolvedVatToNewProforma(synced, vatTotals) as T,
      payment,
    ),
    vatTotals,
  };
}

export type LegacyProformaPaymentPlanSnapshot = {
  value?: number | string | null;
  vat_value?: number | string | null;
  order?: string | number | null;
  currency_id?: number | string | null;
};

/** Merge legacy proforma invoice rows with live finances_paymentplanrow amounts. */
export function applyLegacyPaymentPlanAmountsToProforma<T extends Record<string, unknown>>(
  proforma: T,
  payment: LegacyProformaPaymentPlanSnapshot,
): { proforma: T; vatTotals: ResolvedProformaVat } {
  const synced = syncProformaLineItemsWithPaymentValue(proforma, payment.value);
  const vatTotals = resolveLegacyProformaVat(synced, {
    value: payment.value,
    vat_value: payment.vat_value,
    order: payment.order ?? (synced as { paymentOrder?: string | number }).paymentOrder,
  });
  return {
    proforma: normalizeProformaCurrencyFields(synced, {
      currency_code: (synced as { currency_code?: string }).currency_code,
      currency_id: payment.currency_id ?? (synced as { currency_id?: number | string }).currency_id,
    }),
    vatTotals,
  };
}
