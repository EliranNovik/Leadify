import { getVatRateForLegacyLead } from './legacyProformaVat';

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

/** Matches FinancesTab — VAT only on Israeli shekel. */
export function isIsraeliShekelCurrency(currency: string | null | undefined): boolean {
  if (!currency) return true;
  const c = String(currency).trim();
  return c === '₪' || c === 'ILS' || c === 'NIS';
}

export type ProformaVatInput = {
  currency?: string | null;
  valueVat?: number | string | null;
  paymentOrder?: number | string | null;
  dueDate?: string | null;
  subtotal: number;
};

/** Derive addVat + amounts from payment plan (FinancesTab rules). */
export function computeProformaVatFromPayment({
  currency,
  valueVat,
  paymentOrder,
  dueDate,
  subtotal,
}: ProformaVatInput) {
  const addVat =
    isIsraeliShekelCurrency(currency) && !isExpenseNoVatPayment(paymentOrder);
  const vatRate = getVatRateForLegacyLead(dueDate);
  const numericVat = Number(valueVat) || 0;

  let vat = 0;
  if (addVat) {
    vat = numericVat > 0 ? numericVat : Math.round(subtotal * vatRate * 100) / 100;
  }

  const totalWithVat = addVat ? Math.round((subtotal + vat) * 100) / 100 : subtotal;

  return { addVat, vat, vatRate, totalWithVat };
}
