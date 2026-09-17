/** Display label for payment_plans.payment_order / finances_paymentplanrow.order. */
export function paymentOrderLabel(order: number | string | null | undefined): string {
  if (order == null || order === '') return 'Payment';
  if (typeof order === 'string') {
    const lower = order.toLowerCase();
    if (
      lower.includes('first') ||
      lower.includes('intermediate') ||
      lower.includes('final') ||
      lower.includes('single') ||
      lower.includes('expense')
    ) {
      return order;
    }
    const num = parseInt(order, 10);
    if (!Number.isNaN(num)) {
      return paymentOrderLabel(num);
    }
    return order;
  }
  switch (order) {
    case 1:
      return 'First Payment';
    case 5:
      return 'Intermediate Payment';
    case 9:
      return 'Final Payment';
    case 90:
      return 'Single Payment';
    case 99:
      return 'Expense (no VAT)';
    default:
      return 'Payment';
  }
}
