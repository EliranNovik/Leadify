import { supabase } from './supabase';
import { readPaymentPlanVatFromRow } from './paymentPlanVat';
import { paymentOrderLabel } from './paymentPlanOrderLabel';

export const PAYMENT_AMOUNT_MATCH_EPS = 0.009;

export type PaymentPlanCheckoutSnapshot = {
  amount: number;
  vatAmount: number;
  totalAmount: number;
  orderLabel: string;
  currency: string;
  paid: boolean;
};

export function roundPaymentMoney(value: number): number {
  return Math.round((Number(value) || 0) * 100) / 100;
}

export function paymentAmountsEqual(a: number, b: number): boolean {
  return Math.abs(roundPaymentMoney(a) - roundPaymentMoney(b)) <= PAYMENT_AMOUNT_MATCH_EPS;
}

export function buildPaymentLinkDescription(
  orderLabel: string,
  clientName: string,
  leadNumber: string,
): string {
  return `${orderLabel} - ${clientName} (#${leadNumber})`;
}

type NewPlanRow = {
  value?: number | string | null;
  value_vat?: number | string | null;
  payment_order?: string | number | null;
  currency?: string | null;
  currency_id?: number | string | null;
  due_date?: string | null;
  paid?: boolean | null;
};

type LegacyPlanRow = {
  value?: number | string | null;
  vat_value?: number | string | null;
  order?: string | number | null;
  currency_id?: number | string | null;
  date?: string | null;
  due_date?: string | null;
  actual_date?: string | null;
  accounting_currencies?: { name?: string | null; iso_code?: string | null } | null;
};

export function checkoutSnapshotFromNewPlanRow(
  row: NewPlanRow | null | undefined,
): PaymentPlanCheckoutSnapshot | null {
  if (!row) return null;
  const amount = roundPaymentMoney(Number(row.value) || 0);
  const vatAmount = roundPaymentMoney(readPaymentPlanVatFromRow(row, false));
  return {
    amount,
    vatAmount,
    totalAmount: roundPaymentMoney(amount + vatAmount),
    orderLabel: paymentOrderLabel(row.payment_order),
    currency: row.currency || '₪',
    paid: Boolean(row.paid),
  };
}

export function checkoutSnapshotFromLegacyPlanRow(
  row: LegacyPlanRow | null | undefined,
): PaymentPlanCheckoutSnapshot | null {
  if (!row) return null;
  const amount = roundPaymentMoney(Number(row.value) || 0);
  const vatAmount = roundPaymentMoney(readPaymentPlanVatFromRow(row, true));
  const currencyName = row.accounting_currencies?.name || row.accounting_currencies?.iso_code;
  return {
    amount,
    vatAmount,
    totalAmount: roundPaymentMoney(amount + vatAmount),
    orderLabel: paymentOrderLabel(row.order),
    currency: currencyName || '₪',
    paid: Boolean(row.actual_date),
  };
}

export function paymentLinkMatchesSnapshot(
  link: {
    amount?: number | string | null;
    vat_amount?: number | string | null;
    total_amount?: number | string | null;
    description?: string | null;
  },
  snapshot: PaymentPlanCheckoutSnapshot,
  description?: string | null,
): boolean {
  if (!paymentAmountsEqual(Number(link.amount) || 0, snapshot.amount)) return false;
  if (!paymentAmountsEqual(Number(link.vat_amount) || 0, snapshot.vatAmount)) return false;
  if (!paymentAmountsEqual(Number(link.total_amount) || 0, snapshot.totalAmount)) return false;
  if (description) {
    const current = (link.description || '').trim();
    if (current && current !== description.trim()) return false;
  } else {
    const prefix = (link.description || '').split(' - ')[0]?.trim();
    if (prefix && prefix !== snapshot.orderLabel) return false;
  }
  return true;
}

export function applyCheckoutSnapshotToPaymentLink<T extends object>(
  link: T,
  snapshot: PaymentPlanCheckoutSnapshot,
  description?: string | null,
): T {
  const nextDescription =
    description?.trim() ||
    (typeof link.description === 'string' && link.description.includes(' - ')
      ? `${snapshot.orderLabel} - ${link.description.split(' - ').slice(1).join(' - ')}`
      : snapshot.orderLabel);
  return {
    ...link,
    amount: snapshot.amount,
    vat_amount: snapshot.vatAmount,
    total_amount: snapshot.totalAmount,
    currency: snapshot.currency || (link.currency as string) || '₪',
    description: nextDescription,
  };
}

export async function fetchPaymentPlanCheckoutSnapshot(
  paymentPlanId: number,
  isLegacyPaymentPlan: boolean,
): Promise<PaymentPlanCheckoutSnapshot | null> {
  if (isLegacyPaymentPlan) {
    const { data, error } = await supabase
      .from('finances_paymentplanrow')
      .select(
        `
        id,
        value,
        vat_value,
        order,
        currency_id,
        date,
        actual_date,
        accounting_currencies!finances_paymentplanrow_currency_id_fkey (
          name,
          iso_code
        )
      `,
      )
      .eq('id', paymentPlanId)
      .maybeSingle();
    if (error) {
      console.error('[payment-link] fetch legacy plan snapshot:', error);
      return null;
    }
    const currencies = data?.accounting_currencies;
    const currencyRow = Array.isArray(currencies) ? currencies[0] : currencies;
    return checkoutSnapshotFromLegacyPlanRow(
      data ? { ...data, accounting_currencies: currencyRow ?? null } : null,
    );
  }

  const { data, error } = await supabase
    .from('payment_plans')
    .select('id, value, value_vat, payment_order, currency, currency_id, due_date, paid')
    .eq('id', paymentPlanId)
    .maybeSingle();
  if (error) {
    console.error('[payment-link] fetch plan snapshot:', error);
    return null;
  }
  return checkoutSnapshotFromNewPlanRow(data);
}
