import { getVatRateForLegacyLead } from './legacyProformaVat';
import { isExpenseNoVatPayment, isIsraeliShekelCurrency } from './proformaVat';

/** DB row has an explicit VAT amount (including 0 = VAT turned off). */
export function isPaymentPlanVatExplicitlySet(raw: number | string | null | undefined): boolean {
  return raw != null && raw !== '' && Number.isFinite(Number(raw));
}

export function parseExplicitPaymentPlanVat(
  raw: number | string | null | undefined,
): { explicit: boolean; amount: number } {
  if (!isPaymentPlanVatExplicitlySet(raw)) {
    return { explicit: false, amount: 0 };
  }
  return { explicit: true, amount: Number(raw) || 0 };
}

type PaymentPlanVatRow = {
  value?: number | string | null;
  value_vat?: number | string | null;
  vat_value?: number | string | null;
  currency?: string | null;
  currency_id?: number | string | null;
  due_date?: string | null;
  date?: string | null;
  payment_order?: string | number | null;
  order?: string | number | null;
};

/** FinancesTab display: respect stored value_vat / vat_value (0 = off); auto-calc only when unset. */
export function readPaymentPlanVatFromRow(row: PaymentPlanVatRow, isLegacy = false): number {
  const raw = isLegacy ? row.vat_value : row.value_vat;
  if (isPaymentPlanVatExplicitlySet(raw)) {
    return Number(raw) || 0;
  }

  const value = Number(row.value) || 0;
  const order = isLegacy ? row.order : row.payment_order;
  if (isExpenseNoVatPayment(order)) return 0;

  const dueDate = isLegacy ? row.date ?? row.due_date : row.due_date;
  if (isIsraeliShekelCurrency(row.currency, row.currency_id)) {
    const rate = getVatRateForLegacyLead(dueDate);
    return Math.round(value * rate * 100) / 100;
  }

  return 0;
}

export function calculatePaymentPlanVatAmount(
  value: number | string | null | undefined,
  includeVat: boolean,
  dueDate: string | null | undefined,
): number {
  if (!includeVat) return 0;
  const base = Number(value) || 0;
  const rate = getVatRateForLegacyLead(dueDate);
  return Math.round(base * rate * 100) / 100;
}
