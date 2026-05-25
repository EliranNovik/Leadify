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
