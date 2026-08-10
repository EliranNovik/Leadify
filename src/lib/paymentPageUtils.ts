/** User-facing payment form error copy (raw error stays in console only). */
export function paymentFormErrorCopy(_raw?: string | null): {
  title: string;
  subtext: string;
} {
  return {
    title: 'Could not load the secure payment form.',
    subtext: 'Please try again or contact us for help.',
  };
}

export function formatMoneyAmount(amount: number, symbol: string): string {
  const sym = symbol || '₪';
  const formatted = Number(amount).toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  return `${sym}${formatted}`;
}

/**
 * Prefer payment_links.total_amount as the payable gross.
 * If `amount` was stored as gross while vat is still present (amount ≈ total, vat > 0),
 * recover net as total − vat so the UI does not show VAT twice.
 */
export function normalizePaymentLinkAmounts(input: {
  subtotal: number;
  vat: number;
  total: number;
}): { subtotal: number; vat: number; total: number } {
  const subtotal = Number(input.subtotal) || 0;
  const vat = Number(input.vat) || 0;
  const total = Number(input.total) || 0;
  const sum = subtotal + vat;

  if (total > 0 && Math.abs(sum - total) <= 0.05) {
    return { subtotal, vat, total };
  }

  // Gross stored in amount (and often mirrored into total_amount) while vat_amount > 0.
  if (total > 0 && vat > 0 && Math.abs(subtotal - total) <= 0.05) {
    return {
      subtotal: Math.max(0, Math.round((total - vat) * 100) / 100),
      vat,
      total,
    };
  }

  if (total > 0) {
    return { subtotal, vat, total };
  }

  return { subtotal, vat, total: sum };
}
